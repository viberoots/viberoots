import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  hashesJsonPaths,
  type HashesJsonOptions,
  type HashesJsonOwner,
  ownerHashesJsonPath,
  unique,
  viberootsHashesJsonPaths,
  workspaceHashesJsonPath,
  writableHashesJsonPaths,
} from "./hashes-json-paths";

export {
  hashOwnerForLockfile,
  isStandaloneViberootsSource,
  type HashesJsonOptions,
  type HashesJsonOwner,
} from "./hashes-json-paths";

export async function snapshotNodeModulesHashesJson(
  lockfileRel: string,
  opts: HashesJsonOptions = {},
): Promise<{ restore: () => Promise<void> }> {
  const root = opts.root ? path.resolve(opts.root) : process.cwd();
  const owner = ownerHashesJsonPath(lockfileRel, opts.owner, root);
  const candidates = unique([owner, ...writableHashesJsonPaths(root)]);
  const before = new Map<string, Buffer | null>();
  for (const candidate of candidates) {
    before.set(candidate, await fsp.readFile(candidate).catch(() => null));
  }
  return {
    restore: async () => {
      for (const [candidate, contents] of before) {
        if (contents === null) {
          await fsp.rm(candidate, { force: true });
          await fsp.rmdir(path.dirname(candidate)).catch(() => {});
          continue;
        }
        await fsp.mkdir(path.dirname(candidate), { recursive: true });
        await fsp.writeFile(candidate, contents);
      }
    },
  };
}

async function readJsonFile(candidate: string): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fsp.readFile(candidate, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeJsonFile(candidate: string, obj: Record<string, string>): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
  const payload = JSON.stringify(sorted, null, 2) + "\n";
  await fsp.mkdir(path.dirname(candidate), { recursive: true });
  await fsp.writeFile(candidate, payload, "utf8");
}

function postCloneHashesReadonly(): boolean {
  if (String(process.env.VBR_PNPM_HASHES_READONLY || "").trim() === "1") return true;
  return String(process.env.VBR_POST_CLONE || "").trim() === "1";
}

function readonlyMutationError(action: string, file: string, detail: string): Error {
  return new Error(
    [
      `refusing to ${action} during post-clone: ${path.relative(process.cwd(), file) || file}`,
      detail,
      "post-clone must not mutate tracked pnpm hash metadata; run normal viberoots update in a development checkout and commit the deterministic hash fix.",
    ].join("\n"),
  );
}

async function readHashesJson(root = process.cwd()): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const candidate of hashesJsonPaths(root)) {
    Object.assign(merged, await readJsonFile(candidate));
  }
  return merged;
}

async function readOwnerHashesJson(
  owner: HashesJsonOwner,
  root = process.cwd(),
): Promise<Record<string, string>> {
  const candidates =
    owner === "viberoots"
      ? unique([
          ...viberootsHashesJsonPaths(root),
          ownerHashesJsonPath("pnpm-lock.yaml", owner, root),
        ])
      : [workspaceHashesJsonPath(root)];
  const merged: Record<string, string> = {};
  for (const candidate of candidates) {
    Object.assign(merged, await readJsonFile(candidate));
  }
  return merged;
}

async function removeHashFromNonOwnerFiles(
  lockfileRel: string,
  owner: string,
  root = process.cwd(),
): Promise<void> {
  const ownerReal = await fsp.realpath(owner).catch(() => path.resolve(owner));
  for (const candidate of writableHashesJsonPaths(root)) {
    if (candidate === owner) continue;
    const candidateReal = await fsp.realpath(candidate).catch(() => path.resolve(candidate));
    if (candidateReal === ownerReal) continue;
    const obj = await readJsonFile(candidate);
    if (!(lockfileRel in obj)) continue;
    delete obj[lockfileRel];
    await writeJsonFile(candidate, obj).catch(() => {});
  }
}

export async function updateNodeModulesHashesJson(
  lockfileRel: string,
  newHash: string,
  opts: HashesJsonOptions = {},
) {
  const root = opts.root ? path.resolve(opts.root) : process.cwd();
  const owner = ownerHashesJsonPath(lockfileRel, opts.owner, root);
  const obj = await readJsonFile(owner);
  const previousHash = String(obj[lockfileRel] || "").trim();
  if (postCloneHashesReadonly() && previousHash !== newHash) {
    throw readonlyMutationError(
      "update pnpm hash metadata",
      owner,
      `${lockfileRel}: ${previousHash || "(missing)"} -> ${newHash}`,
    );
  }
  obj[lockfileRel] = newHash;
  await writeJsonFile(owner, obj);
  if (opts.owner !== "viberoots") {
    await removeHashFromNonOwnerFiles(lockfileRel, owner, root);
  }
}

export async function pruneNodeModulesHashesJson(
  keepLockfiles: string[],
  opts: { root?: string } = {},
): Promise<string[]> {
  const keep = new Set(keepLockfiles);
  const removed: string[] = [];
  const root = opts.root ? path.resolve(opts.root) : process.cwd();
  for (const candidate of writableHashesJsonPaths(root)) {
    const obj = await readJsonFile(candidate);
    let changed = false;
    for (const key of Object.keys(obj)) {
      if (keep.has(key)) continue;
      removed.push(key);
      delete obj[key];
      changed = true;
    }
    if (changed) {
      if (postCloneHashesReadonly()) {
        throw readonlyMutationError(
          "prune pnpm hash metadata",
          candidate,
          `stale entries: ${removed.join(", ")}`,
        );
      }
      await writeJsonFile(candidate, obj).catch(() => {});
    }
  }
  return unique(removed).sort();
}

export async function readNodeModulesHashForLockfile(
  lockfileRel: string,
  opts: HashesJsonOptions = {},
): Promise<string> {
  try {
    const root = opts.root ? path.resolve(opts.root) : process.cwd();
    const obj = opts.owner
      ? await readOwnerHashesJson(opts.owner, root)
      : await readHashesJson(root);
    const v = String(obj[lockfileRel] || "").trim();
    return v;
  } catch {
    return "";
  }
}
