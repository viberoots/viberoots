import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "zx/globals";
import { writeIfChanged } from "../../lib/fs-helpers";
import { runManagedCommand } from "../../lib/managed-command";
import { verifySeedBuildArgs, type VerifySeedBuildMode } from "./seed-build";
import { shouldStageSeed, stageSeedStore } from "./seed-staging";
import { writeVerifySeedRemoteManifest } from "./seed-manifest";
import { isNonBuildSystemOnlyVerifyTargets } from "./target-scope";
import { pidAlive } from "./seed-utils";

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
  return !isNonBuildSystemOnlyVerifyTargets(effectiveTargets);
}

function seedRootDir(root: string): string {
  return path.join(root, "buck-out", "tmp", "verify-seed");
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

async function gitOutput(root: string, cmd: string[]): Promise<string> {
  const res = await $({ cwd: root, stdio: "pipe", reject: false })`${cmd}`;
  if (res.exitCode !== 0) throw new Error(`verify seed: git ${cmd.join(" ")} failed`);
  return String(res.stdout || "").trimEnd();
}

async function computeSeedKey(root: string): Promise<string> {
  const head = await gitOutput(root, ["git", "rev-parse", "HEAD"]);
  const statusRaw = await $({
    cwd: root,
    stdio: "pipe",
    reject: false,
    nothrow: true,
  })`git status --porcelain=v1 -z`;
  if (statusRaw.exitCode !== 0) {
    throw new Error("verify seed: git status --porcelain=v1 -z failed");
  }
  const status = String(statusRaw.stdout || "");
  const statusEntries = status ? status.split("\0").filter(Boolean) : [];
  let diffHash = "";
  let diffCachedHash = "";
  if (statusEntries.length > 0) {
    try {
      const diff = await gitOutput(root, ["git", "diff", "--no-ext-diff", "--binary"]);
      diffHash = crypto.createHash("sha256").update(diff).digest("hex");
    } catch {}
    try {
      const diffCached = await gitOutput(root, [
        "git",
        "diff",
        "--cached",
        "--no-ext-diff",
        "--binary",
      ]);
      diffCachedHash = crypto.createHash("sha256").update(diffCached).digest("hex");
    } catch {}
  }

  const payload = {
    workspaceRoot: root,
    head,
    statusEntries,
    diffHash,
    diffCachedHash,
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
  await fsp.mkdir(seedRootDir(root), { recursive: true }).catch(() => {});
  process.stderr.write(
    `[verify] seed build: nix build ${root}#test-seed (timeout=${timeoutSec}s)\n`,
  );
  const cmd = await runManagedCommand({
    command: "nix",
    args: verifySeedBuildArgs({ root, mode, gcRootPath }),
    cwd: root,
    env: { ...process.env, IN_NIX_SHELL: process.env.IN_NIX_SHELL || "1" },
    timeoutMs: timeoutSec * 1000,
    killGraceMs: 5000,
  });
  if (!cmd.ok) {
    const detail = String(cmd.stderr || cmd.stdout || "").trim();
    if (cmd.timedOut) {
      throw new Error(
        `verify seed: nix build .#test-seed timed out after ${timeoutSec}s${detail ? `\n${detail}` : ""}`,
      );
    }
    throw new Error(
      `verify seed: nix build .#test-seed failed (exit ${String(cmd.code)})${detail ? `\n${detail}` : ""}`,
    );
  }
  const out = String(cmd.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!out) throw new Error("verify seed: nix build .#test-seed returned no store path");
  process.stderr.write("[verify] seed build: complete\n");
  return out;
}

async function writeCurrentSeed(root: string, seedPath: string, seedKey: string): Promise<void> {
  const dir = seedRootDir(root);
  await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  await writeIfChanged(path.join(dir, "current"), seedPath + "\n");
  await writeIfChanged(path.join(dir, "current.key"), seedKey + "\n");
}

async function createPin(
  root: string,
  iso: string,
  seedPath: string,
  seedKey: string,
): Promise<string> {
  const pinDir = path.join(pinRootDir(root), iso);
  await fsp.mkdir(pinDir, { recursive: true }).catch(() => {});
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
  const seedPath = await buildSeedStorePath(opts.root, mode);
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
    ? await stageSeedStore(seedPath, seedKey, seedTtlMs)
    : seedPath;
  await writeCurrentSeed(opts.root, seedPathForRun, seedKey);
  const pinDir = await createPin(opts.root, opts.iso, seedPathForRun, seedKey);
  const cleanup = async () => {
    await fsp.rm(pinDir, { recursive: true, force: true }).catch(() => {});
  };
  return { seedKey, seedPath: seedPathForRun, pinDir, cleanup };
}
