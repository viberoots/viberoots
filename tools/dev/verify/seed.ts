import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import "zx/globals";
import { writeIfChanged } from "../../lib/fs-helpers.ts";
import { shouldStageSeed, stageSeedStore } from "./seed-staging.ts";
import { pidAlive } from "./seed-utils.ts";

type SeedInfo = {
  seedKey: string;
  seedPath: string;
  pinDir: string;
  cleanup: () => Promise<void>;
};

const seedTtlMs = 24 * 60 * 60 * 1000;

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
  const payload = {
    workspaceRoot: root,
    head,
    statusEntries,
    seedConfig: {
      TEST_RSYNC_ROOTS: String(process.env.TEST_RSYNC_ROOTS || ""),
      TEST_PARTIAL_CLONE_GO_ONLY: String(process.env.TEST_PARTIAL_CLONE_GO_ONLY || ""),
      TEST_EXCLUDE_CPP_REQS: String(process.env.TEST_EXCLUDE_CPP_REQS || ""),
    },
  };
  return JSON.stringify(payload);
}

async function buildSeedStorePath(root: string): Promise<string> {
  const res = await $({
    cwd: root,
    stdio: "pipe",
    reject: false,
  })`nix build --impure ${root}#test-seed --accept-flake-config --no-link --print-out-paths`;
  if (res.exitCode !== 0) throw new Error("verify seed: nix build .#test-seed failed");
  const out = String(res.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!out) throw new Error("verify seed: nix build .#test-seed returned no store path");
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

export async function prepareVerifySeed(opts: { root: string; iso: string }): Promise<SeedInfo> {
  await sweepStalePins(opts.root);
  const seedKey = await computeSeedKey(opts.root);
  const seedPath = await buildSeedStorePath(opts.root);
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
