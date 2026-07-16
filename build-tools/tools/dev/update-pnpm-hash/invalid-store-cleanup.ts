import * as fsp from "node:fs/promises";
import path from "node:path";
import { runManagedCommand } from "../../lib/managed-command";
import { openFileOwnerPids } from "../../lib/open-file-inspection";
import { resolveToolPathSync } from "../../lib/tool-paths";

export const INVALID_STORE_QUERY_TIMEOUT_MS = 30_000;
export const INVALID_STORE_CLEANUP_TIMEOUT_MS = 120_000;
export const INVALID_STORE_SHUTDOWN_MARGIN_MS = 5_000;

export type InvalidStorePathEvidence = { sizeKib: number; mtimeMs: number };
export type InvalidStoreSnapshot = Map<string, InvalidStorePathEvidence>;

export type InvalidStoreCleanupDeps = {
  listStoreEntries: () => Promise<string[]>;
  isValid: (storePath: string) => Promise<boolean>;
  evidence: (storePath: string) => Promise<InvalidStorePathEvidence>;
  referrers: (storePath: string) => Promise<string[]>;
  roots: (storePath: string) => Promise<string[]>;
  openOwners: (storePath: string) => Promise<string[]>;
  deletePath: (storePath: string) => Promise<void>;
};

export async function runInvalidStoreCleanupCommand(
  command: string,
  args: string[],
  timeoutMs = INVALID_STORE_QUERY_TIMEOUT_MS,
): Promise<{ ok: boolean; lines: string[]; errorLines: string[]; timedOut: boolean }> {
  const result = await runManagedCommand({ command, args, timeoutMs, killGraceMs: 1_000 });
  return {
    ok: result.ok,
    lines: result.stdout.split(/\r?\n/).filter(Boolean),
    errorLines: [
      ...(result.timedOut ? [`command timed out after ${timeoutMs}ms`] : []),
      ...result.stderr.split(/\r?\n/).filter(Boolean),
    ],
    timedOut: result.timedOut,
  };
}

export function storePathValidityFromCommand(
  storePath: string,
  result: { ok: boolean; errorLines: string[] },
): boolean {
  if (result.ok) return true;
  if (result.errorLines.some((line) => line.includes(`path '${storePath}' is not valid`))) {
    return false;
  }
  throw new Error(`could not determine Nix store validity for ${storePath}`);
}

async function requiredCommandLines(
  run: (
    command: string,
    args: string[],
  ) => Promise<{
    ok: boolean;
    lines: string[];
  }>,
  command: string,
  args: string[],
  label: string,
): Promise<string[]> {
  const result = await run(command, args);
  if (!result.ok) throw new Error(`could not query Nix store ${label}`);
  return result.lines;
}

function remainingMs(deadlineMs: number): number {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new Error("invalid pnpm store cleanup exceeded its aggregate deadline");
  return remaining;
}

export function invalidStoreChildTimeoutMs(
  deadlineMs: number,
  capMs: number,
  minimumMs = 1,
  nowMs = Date.now(),
): number {
  const available = deadlineMs - nowMs - INVALID_STORE_SHUTDOWN_MARGIN_MS;
  if (available < minimumMs) {
    throw new Error("invalid pnpm store cleanup exceeded its aggregate deadline");
  }
  return Math.min(capMs, available);
}

async function beforeDeadline<T>(deadlineMs: number, operation: () => Promise<T>): Promise<T> {
  const timeoutMs = remainingMs(deadlineMs);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("invalid pnpm store cleanup exceeded its aggregate deadline")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function defaultDeps(env: NodeJS.ProcessEnv, deadlineMs: number): InvalidStoreCleanupDeps {
  const nixStore = resolveToolPathSync("nix-store", env);
  const du = resolveToolPathSync("du", env);
  const run = async (command: string, args: string[]) =>
    await runInvalidStoreCleanupCommand(
      command,
      args,
      invalidStoreChildTimeoutMs(deadlineMs, INVALID_STORE_QUERY_TIMEOUT_MS),
    );
  return {
    listStoreEntries: async () => await fsp.readdir("/nix/store"),
    isValid: async (storePath) =>
      storePathValidityFromCommand(storePath, await run(nixStore, ["--check-validity", storePath])),
    evidence: async (storePath) => {
      const [stat, measured] = await Promise.all([
        fsp.stat(storePath),
        run(du, ["-sk", storePath]),
      ]);
      const size = measured.lines[0]?.trim().split(/\s+/)[0] || "";
      if (!measured.ok || !/^\d+$/.test(size)) throw new Error(`could not measure ${storePath}`);
      return { sizeKib: Number(size), mtimeMs: stat.mtimeMs };
    },
    referrers: async (storePath) =>
      await requiredCommandLines(
        run,
        nixStore,
        ["--query", "--referrers", storePath],
        `referrers for ${storePath}`,
      ),
    roots: async (storePath) =>
      await requiredCommandLines(
        run,
        nixStore,
        ["--query", "--roots", storePath],
        `roots for ${storePath}`,
      ),
    openOwners: async (storePath) =>
      await openFileOwnerPids(storePath, {
        env,
        timeoutMs: invalidStoreChildTimeoutMs(deadlineMs, 5_000, 250),
      }),
    deletePath: async (storePath) => {
      const deleted = await run(nixStore, ["--delete", storePath]);
      if (!deleted.ok) throw new Error(`nix-store refused to delete ${storePath}`);
    },
  };
}

function ownedStorePath(entry: string, derivationName: string): string | null {
  if (!/^pnpm-store-lock-[a-f0-9]{64}$/.test(derivationName)) {
    throw new Error(`invalid owned pnpm store derivation name: ${derivationName}`);
  }
  const storePath = path.join("/nix/store", entry);
  return new RegExp(`^/nix/store/[a-z0-9]{32}-${derivationName}$`).test(storePath)
    ? storePath
    : null;
}

export async function snapshotOwnedInvalidPnpmStores(opts: {
  derivationName: string;
  env?: NodeJS.ProcessEnv;
  deps?: InvalidStoreCleanupDeps;
  timeoutMs?: number;
}): Promise<InvalidStoreSnapshot> {
  const deadlineMs = Date.now() + (opts.timeoutMs ?? INVALID_STORE_CLEANUP_TIMEOUT_MS);
  const deps = opts.deps || defaultDeps(opts.env || process.env, deadlineMs);
  const snapshot: InvalidStoreSnapshot = new Map();
  for (const entry of await beforeDeadline(deadlineMs, deps.listStoreEntries)) {
    const storePath = ownedStorePath(entry, opts.derivationName);
    if (!storePath || (await beforeDeadline(deadlineMs, () => deps.isValid(storePath)))) continue;
    snapshot.set(storePath, await beforeDeadline(deadlineMs, () => deps.evidence(storePath)));
  }
  return snapshot;
}

export async function cleanupChangedOwnedInvalidPnpmStores(opts: {
  derivationName: string;
  before: InvalidStoreSnapshot;
  env?: NodeJS.ProcessEnv;
  deps?: InvalidStoreCleanupDeps;
  log?: (message: string) => void;
  timeoutMs?: number;
}): Promise<string[]> {
  const deadlineMs = Date.now() + (opts.timeoutMs ?? INVALID_STORE_CLEANUP_TIMEOUT_MS);
  const deps = opts.deps || defaultDeps(opts.env || process.env, deadlineMs);
  const after = await snapshotOwnedInvalidPnpmStores({
    derivationName: opts.derivationName,
    env: opts.env,
    deps,
    timeoutMs: remainingMs(deadlineMs),
  });
  const deleted: string[] = [];
  for (const [storePath, evidence] of after) {
    const prior = opts.before.get(storePath);
    if (prior && evidence.sizeKib <= prior.sizeKib && evidence.mtimeMs <= prior.mtimeMs) continue;
    const entry = path.basename(storePath);
    if (ownedStorePath(entry, opts.derivationName) !== storePath) continue;
    if (await beforeDeadline(deadlineMs, () => deps.isValid(storePath))) continue;
    const referrers = await beforeDeadline(deadlineMs, () => deps.referrers(storePath));
    if (referrers.length > 0) continue;
    const roots = await beforeDeadline(deadlineMs, () => deps.roots(storePath));
    if (roots.length > 0) continue;
    const openOwners = await beforeDeadline(deadlineMs, () => deps.openOwners(storePath));
    if (openOwners.length > 0) continue;
    (opts.log || console.error)(
      `[update-pnpm-hash] interrupted invalid-output cleanup path=${storePath} size_kib=${evidence.sizeKib} mtime_ms=${evidence.mtimeMs} referrers=${referrers.length} roots=${roots.length} open_owners=${openOwners.length}`,
    );
    await beforeDeadline(deadlineMs, () => deps.deletePath(storePath));
    deleted.push(storePath);
  }
  return deleted;
}
