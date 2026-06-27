import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkspaceLockRepairOptions = {
  workspaceRoot: string;
  dryRun?: boolean;
  verbose?: boolean;
  skip?: boolean;
  deps?: WorkspaceLockRepairDeps;
};

export type WorkspaceLockRepairDeps = {
  execFile?: typeof execFileAsync;
  now?: () => Date;
};

export type WorkspaceLockRepairResult =
  | { status: "fresh" }
  | { status: "skipped"; reason: string }
  | { status: "would-repair"; reason: string }
  | { status: "repaired"; changedInput: "viberoots" };

type FlakeLock = {
  nodes?: Record<string, unknown>;
  root?: string;
  version?: number;
};

type MetadataResult = {
  locks?: FlakeLock;
};

function canonicalPath(p: string): string {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function cloneWithoutViberoots(lock: FlakeLock): FlakeLock {
  const cloned = JSON.parse(JSON.stringify(lock)) as FlakeLock;
  if (cloned.nodes) delete cloned.nodes.viberoots;
  return cloned;
}

function viberootsNode(lock: FlakeLock): unknown {
  return lock.nodes?.viberoots;
}

function locksDifferOnlyInViberoots(before: FlakeLock, after: FlakeLock): boolean {
  if (
    stableStringify(cloneWithoutViberoots(before)) !== stableStringify(cloneWithoutViberoots(after))
  ) {
    return false;
  }
  return stableStringify(viberootsNode(before)) !== stableStringify(viberootsNode(after));
}

function validLocalViberootsSource(workspaceRoot: string): string {
  const candidates = [
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    path.join(workspaceRoot, "viberoots"),
  ]
    .map((candidate) => String(candidate || "").trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const abs = canonicalPath(candidate);
    if (
      fs.existsSync(path.join(abs, "flake.nix")) &&
      fs.existsSync(path.join(abs, "build-tools", "tools", "dev", "zx-init.mjs"))
    ) {
      return abs;
    }
  }
  return "";
}

function lockNodeUsesLocalPath(lock: FlakeLock, viberootsSource: string): boolean {
  const node = viberootsNode(lock) as
    | {
        locked?: { type?: string; path?: string };
        original?: { type?: string; path?: string };
      }
    | undefined;
  if (!node) return false;
  const locked = node.locked;
  const original = node.original;
  if (locked?.type !== "path" || !locked.path) return false;
  if (canonicalPath(locked.path) === viberootsSource) return true;
  return original?.type === "path" && Boolean(original.path);
}

async function metadataLocks(opts: {
  workspaceFlakeDir: string;
  viberootsSource: string;
  execFileImpl: typeof execFileAsync;
}): Promise<FlakeLock | null> {
  const { stdout } = await opts.execFileImpl(
    "nix",
    [
      "flake",
      "metadata",
      "--json",
      "--no-write-lock-file",
      "--accept-flake-config",
      `path:${opts.workspaceFlakeDir}`,
      "--override-input",
      "viberoots",
      `path:${opts.viberootsSource}`,
    ],
    { maxBuffer: 1024 * 1024 * 64 },
  );
  const parsed = JSON.parse(String(stdout || "{}")) as MetadataResult;
  return parsed.locks || null;
}

async function writeLockAtomically(lockFile: string, next: FlakeLock): Promise<void> {
  const tmp = `${lockFile}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, lockFile);
}

export async function repairGeneratedWorkspaceLock(
  opts: WorkspaceLockRepairOptions,
): Promise<WorkspaceLockRepairResult> {
  if (opts.skip || String(process.env.VBR_SKIP_WORKSPACE_LOCK_REPAIR || "").trim() === "1") {
    return { status: "skipped", reason: "disabled" };
  }
  const workspaceRoot = canonicalPath(opts.workspaceRoot);
  const workspaceFlakeDir = path.join(workspaceRoot, ".viberoots", "workspace");
  const lockFile = path.join(workspaceFlakeDir, "flake.lock");
  if (!(await exists(path.join(workspaceFlakeDir, "flake.nix")))) {
    return { status: "skipped", reason: "missing-generated-workspace-flake" };
  }
  if (!(await exists(lockFile))) {
    return { status: "skipped", reason: "missing-generated-workspace-lock" };
  }
  const viberootsSource = validLocalViberootsSource(workspaceRoot);
  if (!viberootsSource) return { status: "skipped", reason: "no-local-viberoots-source" };

  const beforeText = await fsp.readFile(lockFile, "utf8");
  const before = JSON.parse(beforeText) as FlakeLock;
  if (!lockNodeUsesLocalPath(before, viberootsSource)) {
    return { status: "skipped", reason: "viberoots-input-is-not-local-path" };
  }

  if (opts.verbose) {
    console.error("[install-deps] checking generated workspace viberoots lock input");
  }
  const candidate = await metadataLocks({
    workspaceFlakeDir,
    viberootsSource,
    execFileImpl: opts.deps?.execFile || execFileAsync,
  });
  if (!candidate?.nodes?.viberoots) {
    return { status: "skipped", reason: "metadata-did-not-return-viberoots-lock-node" };
  }
  if (stableStringify(before) === stableStringify(candidate)) {
    return { status: "fresh" };
  }
  if (!locksDifferOnlyInViberoots(before, candidate)) {
    return { status: "skipped", reason: "candidate-changed-non-viberoots-inputs" };
  }
  if (opts.dryRun) {
    return { status: "would-repair", reason: "stale-viberoots-input" };
  }

  console.error("[install-deps] refreshing generated workspace viberoots lock input");
  const now = opts.deps?.now?.() || new Date();
  const backup = `${lockFile}.vbr-repair.${process.pid}.${now
    .toISOString()
    .replaceAll(/[:.]/g, "-")}.bak`;
  await fsp.writeFile(backup, beforeText, "utf8");
  try {
    await writeLockAtomically(lockFile, candidate);
    const after = await readJson<FlakeLock>(lockFile);
    if (!after || !locksDifferOnlyInViberoots(before, after)) {
      await fsp.writeFile(lockFile, beforeText, "utf8");
      throw new Error("generated workspace lock repair validation failed");
    }
    await fsp.rm(backup, { force: true });
    return { status: "repaired", changedInput: "viberoots" };
  } catch (error) {
    await fsp.writeFile(lockFile, beforeText, "utf8").catch(() => {});
    throw error;
  }
}
