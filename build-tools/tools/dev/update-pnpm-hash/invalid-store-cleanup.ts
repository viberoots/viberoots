import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { openFileOwnerPids } from "../../lib/open-file-inspection";
import { resolveToolPathSync } from "../../lib/tool-paths";

const execFileAsync = promisify(execFile);

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

async function commandLines(
  command: string,
  args: string[],
): Promise<{ ok: boolean; lines: string[]; errorLines: string[] }> {
  try {
    const { stdout } = await execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 4 });
    return {
      ok: true,
      lines: String(stdout || "")
        .split(/\r?\n/)
        .filter(Boolean),
      errorLines: [],
    };
  } catch (error) {
    const stdout = String((error as { stdout?: unknown }).stdout || "");
    const stderr = String((error as { stderr?: unknown }).stderr || "");
    return {
      ok: false,
      lines: stdout.split(/\r?\n/).filter(Boolean),
      errorLines: stderr.split(/\r?\n/).filter(Boolean),
    };
  }
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
  command: string,
  args: string[],
  label: string,
): Promise<string[]> {
  const result = await commandLines(command, args);
  if (!result.ok) throw new Error(`could not query Nix store ${label}`);
  return result.lines;
}

function defaultDeps(env: NodeJS.ProcessEnv): InvalidStoreCleanupDeps {
  const nixStore = resolveToolPathSync("nix-store", env);
  const du = resolveToolPathSync("du", env);
  return {
    listStoreEntries: async () => await fsp.readdir("/nix/store"),
    isValid: async (storePath) =>
      storePathValidityFromCommand(
        storePath,
        await commandLines(nixStore, ["--check-validity", storePath]),
      ),
    evidence: async (storePath) => {
      const [stat, measured] = await Promise.all([
        fsp.stat(storePath),
        commandLines(du, ["-sk", storePath]),
      ]);
      const size = measured.lines[0]?.trim().split(/\s+/)[0] || "";
      if (!measured.ok || !/^\d+$/.test(size)) throw new Error(`could not measure ${storePath}`);
      return { sizeKib: Number(size), mtimeMs: stat.mtimeMs };
    },
    referrers: async (storePath) =>
      await requiredCommandLines(
        nixStore,
        ["--query", "--referrers", storePath],
        `referrers for ${storePath}`,
      ),
    roots: async (storePath) =>
      await requiredCommandLines(
        nixStore,
        ["--query", "--roots", storePath],
        `roots for ${storePath}`,
      ),
    openOwners: async (storePath) => await openFileOwnerPids(storePath, { env }),
    deletePath: async (storePath) => {
      const deleted = await commandLines(nixStore, ["--delete", storePath]);
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
}): Promise<InvalidStoreSnapshot> {
  const deps = opts.deps || defaultDeps(opts.env || process.env);
  const snapshot: InvalidStoreSnapshot = new Map();
  for (const entry of await deps.listStoreEntries()) {
    const storePath = ownedStorePath(entry, opts.derivationName);
    if (!storePath || (await deps.isValid(storePath))) continue;
    snapshot.set(storePath, await deps.evidence(storePath));
  }
  return snapshot;
}

export async function cleanupChangedOwnedInvalidPnpmStores(opts: {
  derivationName: string;
  before: InvalidStoreSnapshot;
  env?: NodeJS.ProcessEnv;
  deps?: InvalidStoreCleanupDeps;
}): Promise<string[]> {
  const deps = opts.deps || defaultDeps(opts.env || process.env);
  const after = await snapshotOwnedInvalidPnpmStores({
    derivationName: opts.derivationName,
    env: opts.env,
    deps,
  });
  const deleted: string[] = [];
  for (const [storePath, evidence] of after) {
    const prior = opts.before.get(storePath);
    if (prior && evidence.sizeKib <= prior.sizeKib && evidence.mtimeMs <= prior.mtimeMs) continue;
    const entry = path.basename(storePath);
    if (ownedStorePath(entry, opts.derivationName) !== storePath) continue;
    if (await deps.isValid(storePath)) continue;
    if ((await deps.referrers(storePath)).length > 0) continue;
    if ((await deps.roots(storePath)).length > 0) continue;
    if ((await deps.openOwners(storePath)).length > 0) continue;
    await deps.deletePath(storePath);
    deleted.push(storePath);
  }
  return deleted;
}
