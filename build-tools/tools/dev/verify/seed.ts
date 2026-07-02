import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "zx/globals";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";
import { writeIfChanged } from "../../lib/fs-helpers";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { runManagedCommand } from "../../lib/managed-command";
import { verifySeedBuildArgs, type VerifySeedBuildMode } from "./seed-build";
import { shouldStageSeed, stageSeedStore } from "./seed-staging";
import { writeVerifySeedRemoteManifest } from "./seed-manifest";
import { isNonBuildSystemOnlyVerifyTargets } from "./target-scope";
import { pidAlive } from "./seed-utils";
import { computeGitState } from "./seed-git-state";

export type SeedInfo = {
  seedKey: string;
  seedPath: string;
  pinDir: string;
  remoteManifestPath?: string;
  cleanup: () => Promise<void>;
};

const seedTtlMs = 24 * 60 * 60 * 1000;

function parseVerifySeedMode(raw: string | undefined): "auto" | "always" | "never" {
  const v = String(raw || "auto")
    .trim()
    .toLowerCase();
  if (v === "always") return "always";
  if (v === "never") return "never";
  return "auto";
}

export function shouldPrepareVerifySeedForRequestedTargets(
  effectiveTargets: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = parseVerifySeedMode(env.VBR_VERIFY_SEED_MODE);
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (effectiveTargets.length === 0) return false;
  return !isNonBuildSystemOnlyVerifyTargets(effectiveTargets);
}

function seedRootDir(root: string): string {
  return path.join(root, ".viberoots", "workspace", "buck", "verify-seed");
}

function pinRootDir(root: string): string {
  return path.join(seedRootDir(root), "pins");
}

async function sweepStalePins(root: string): Promise<void> {
  const pinsDir = pinRootDir(root);
  const entries = await fsp.readdir(pinsDir, { withFileTypes: true }).catch(() => []);
  const now = Date.now();
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(pinsDir, ent.name);
    const ownerFile = path.join(dir, "owner.json");
    const txt = await fsp.readFile(ownerFile, "utf8").catch(() => "");
    let pid = 0;
    let startedAt = "";
    try {
      const parsed = JSON.parse(txt || "{}");
      pid = Number(parsed.pid || 0);
      startedAt = String(parsed.startedAt || "");
    } catch {}
    const startedMs = startedAt ? Date.parse(startedAt) : 0;
    const ageMs = startedMs ? now - startedMs : seedTtlMs + 1;
    const stale = !pidAlive(pid) || ageMs > seedTtlMs;
    if (stale) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function computeSeedKey(root: string): Promise<string> {
  const rootGit = await computeGitState(root);
  const viberootsRoot = path.join(root, "viberoots");
  const viberootsGit = await fsp
    .access(path.join(viberootsRoot, ".git"))
    .then(async () => await computeGitState(viberootsRoot))
    .catch(() => null);
  const hiddenWorkspaceState: Record<string, string> = {};
  for (const rel of [
    path.join(".viberoots", "workspace", "flake.nix"),
    path.join(".viberoots", "workspace", "flake.lock"),
  ]) {
    hiddenWorkspaceState[rel] = await fsp.readFile(path.join(root, rel), "utf8").catch(() => "");
  }

  const payload = {
    workspaceRoot: root,
    rootGit,
    viberootsGit,
    hiddenWorkspaceState,
    seedConfig: {
      TEST_RSYNC_ROOTS: String(process.env.TEST_RSYNC_ROOTS || ""),
      TEST_PARTIAL_CLONE_GO_ONLY: String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || ""),
      TEST_EXCLUDE_CPP_REQS: String(process.env.TEST_EXCLUDE_CPP_REQS || ""),
    },
  };
  return JSON.stringify(payload);
}

function seedBuildTimeoutSec(): number {
  const raw = String(process.env.VBR_VERIFY_SEED_BUILD_TIMEOUT_SEC || "").trim();
  const parsed = Number(raw || "300");
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return Math.floor(parsed);
}

async function buildSeedStorePath(
  root: string,
  mode: VerifySeedBuildMode = "local",
): Promise<string> {
  const timeoutSec = seedBuildTimeoutSec();
  // Pin the built derivation as a Nix GC root so nix-collect-garbage does not evict
  // the current seed between verify runs. Each build overwrites the symlink, so only
  // the most-recent seed derivation is pinned; older ones remain GC-eligible.
  const gcRootPath = path.join(seedRootDir(root), "nix-root");
  await mkdirWithMacosMetadataExclusion(seedRootDir(root)).catch(() => {});
  const verbose = isVbrVerbose();
  const ui = createCommandUi({ verbose });
  if (verbose) {
    process.stderr.write(
      `[verify] seed build: nix build path:${root}/.viberoots/workspace#test-seed (timeout=${timeoutSec}s)\n`,
    );
  } else {
    ui.step("seed", "checking test fixture store");
  }
  const cmd = await runManagedCommand({
    command: "nix",
    args: verifySeedBuildArgs({ root, mode, gcRootPath }),
    cwd: root,
    env: {
      ...process.env,
      IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1",
      WORKSPACE_ROOT: root,
      BUCK_TEST_SRC: root,
    },
    timeoutMs: timeoutSec * 1000,
    killGraceMs: 5000,
  });
  if (!cmd.ok) {
    const detail = String(cmd.stderr || cmd.stdout || "").trim();
    if (cmd.timedOut) {
      throw new Error(
        `verify seed: nix build .viberoots/workspace#test-seed timed out after ${timeoutSec}s${detail ? `\n${detail}` : ""}`,
      );
    }
    throw new Error(
      `verify seed: nix build .viberoots/workspace#test-seed failed (exit ${String(cmd.code)})${detail ? `\n${detail}` : ""}`,
    );
  }
  const out = String(cmd.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!out)
    throw new Error("verify seed: nix build .viberoots/workspace#test-seed returned no store path");
  if (verbose) process.stderr.write("[verify] seed build: complete\n");
  else ui.ok("seed", "ready");
  return out;
}

async function writeCurrentSeed(root: string, seedPath: string, seedKey: string): Promise<void> {
  const dir = seedRootDir(root);
  await mkdirWithMacosMetadataExclusion(dir).catch(() => {});
  await writeIfChanged(path.join(dir, "current"), seedPath + "\n");
  await writeIfChanged(path.join(dir, "current.key"), seedKey + "\n");
}

async function readCurrentSeed(root: string, seedKey: string): Promise<string | null> {
  const dir = seedRootDir(root);
  const existingKey = (
    await fsp.readFile(path.join(dir, "current.key"), "utf8").catch(() => "")
  ).trim();
  if (existingKey !== seedKey) return null;
  const seedPath = (await fsp.readFile(path.join(dir, "current"), "utf8").catch(() => "")).trim();
  if (!seedPath) return null;
  const exists = await fsp
    .access(seedPath)
    .then(() => true)
    .catch(() => false);
  return exists ? seedPath : null;
}

async function createPin(
  root: string,
  iso: string,
  seedPath: string,
  seedKey: string,
): Promise<string> {
  const pinDir = path.join(pinRootDir(root), iso);
  await mkdirWithMacosMetadataExclusion(pinDir).catch(() => {});
  await fsp.writeFile(
    path.join(pinDir, "owner.json"),
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), seedKey }) + "\n",
    "utf8",
  );
  const link = path.join(pinDir, "seed");
  await fsp.rm(link, { recursive: true, force: true }).catch(() => {});
  await fsp.symlink(seedPath, link).catch(() => {});
  return pinDir;
}

export async function prepareVerifySeed(opts: {
  root: string;
  iso: string;
  mode?: VerifySeedBuildMode;
}): Promise<SeedInfo> {
  await sweepStalePins(opts.root);
  const mode = opts.mode || "local";
  const seedKey = await computeSeedKey(opts.root);
  const currentSeedPath = mode === "local" ? await readCurrentSeed(opts.root, seedKey) : null;
  const seedPath = currentSeedPath || (await buildSeedStorePath(opts.root, mode));
  if (mode === "remote-ready") {
    const remoteManifestPath = await writeVerifySeedRemoteManifest({
      root: opts.root,
      seedPath,
    });
    await writeCurrentSeed(opts.root, seedPath, seedKey);
    return {
      seedKey,
      seedPath,
      pinDir: "",
      remoteManifestPath,
      cleanup: async () => {},
    };
  }
  const seedPathForRun = (await shouldStageSeed(seedPath))
    ? await stageSeedStore(seedPath, seedKey, seedTtlMs, { workspaceRoot: opts.root })
    : seedPath;
  await writeCurrentSeed(opts.root, seedPathForRun, seedKey);
  const pinDir = await createPin(opts.root, opts.iso, seedPathForRun, seedKey);
  const cleanup = async () => {
    await fsp.rm(pinDir, { recursive: true, force: true }).catch(() => {});
  };
  return { seedKey, seedPath: seedPathForRun, pinDir, cleanup };
}
