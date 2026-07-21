import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathExists } from "../../../../lib/repo";
import type { MaterializedPathInput } from "../../../../dev/filtered-flake-viberoots-input";
import { PREPARED_SEED_MARKER } from "../seed-store-config";
import {
  candidateTempFlakeLockPaths,
  candidateTempFlakePaths,
  isGeneratedFilteredViberootsInputPath,
} from "./filtered-inputs";

export function relFromTempRoot(tmp: string, absPath: string): string {
  return path.relative(tmp, absPath).split(path.sep).join("/");
}

export function uniqueRelPaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map((p) => p.split(path.sep).join("/"))
        .map((p) => p.replace(/^\/+/, ""))
        .filter((p) => p && p !== "." && !p.startsWith("../") && !path.isAbsolute(p)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export async function gitStageRelPaths(
  $tmp: typeof $,
  tmp: string,
  relPaths: string[],
): Promise<void> {
  const paths = uniqueRelPaths(relPaths);
  if (paths.length === 0) return;

  const existing: string[] = [];
  const forceExisting: string[] = [];
  const missing: string[] = [];
  for (const relPath of paths) {
    if (await pathExists(path.join(tmp, relPath))) {
      if (
        relPath === ".viberoots/workspace/flake.nix" ||
        relPath === ".viberoots/workspace/flake.lock"
      ) {
        forceExisting.push(relPath);
      } else if (!relPath.startsWith(".viberoots/")) {
        existing.push(relPath);
      }
    } else {
      missing.push(relPath);
    }
  }

  if (existing.length > 0) {
    await $tmp`git add -- ${existing}`;
  }
  if (forceExisting.length > 0) {
    await $tmp`git add -f -- ${forceExisting}`;
  }
  if (missing.length > 0) {
    await $tmp`git rm -q --ignore-unmatch -- ${missing}`;
  }
}

export async function rewriteTempViberootsInput(
  tmp: string,
  input: MaterializedPathInput,
): Promise<string[]> {
  const activeViberootsRoot = input.storePath;
  const touched: string[] = [];
  for (const flakePath of await candidateTempFlakePaths(tmp)) {
    const text = await fsp.readFile(flakePath, "utf8").catch(() => "");
    if (!text) continue;
    let next = text.replace(
      /(\bviberoots\.url\s*=\s*)"[^"]*"/,
      (_match, prefix: string) => `${prefix}"path:${activeViberootsRoot}"`,
    );
    next = next.replace(/^\s*viberoots\.ref\s*=\s*"[^"]*";\n/gm, "");
    next = next.replace(
      /(inputs\.viberoots\s*=\s*\{\s*url\s*=\s*"path:[^"]*";\n)\s*ref\s*=\s*"[^"]*";\n/g,
      "$1",
    );
    if (!next.includes('"VIBEROOTS_FLAKE_INPUT_ROOT"')) {
      next = next.replace(/(\s*"VIBEROOTS_SOURCE_ROOT"\n)/, '$1    "VIBEROOTS_FLAKE_INPUT_ROOT"\n');
    }
    if (next !== text) {
      await fsp.writeFile(flakePath, next, "utf8");
      touched.push(relFromTempRoot(tmp, flakePath));
    }
  }
  touched.push(...(await rewriteTempViberootsLockInput(tmp, input)));
  return uniqueRelPaths(touched);
}

export function rewriteViberootsLockEntry(
  entry: unknown,
  activeViberootsRoot: string,
  metadata?: Record<string, unknown>,
): boolean {
  if (!entry || typeof entry !== "object") return false;
  const node = entry as { type?: unknown; path?: unknown; url?: unknown };
  const rawPath =
    node.type === "path"
      ? String(node.path || "")
      : node.type === "git"
        ? String(node.url || "").replace(/^file:/, "")
        : "";
  const isRecognized =
    rawPath === "" ||
    path.basename(rawPath) === "viberoots" ||
    /^\/nix\/store\/[a-z0-9]{32}-source$/.test(rawPath) ||
    isGeneratedFilteredViberootsInputPath(rawPath) ||
    String(node.url || "").includes("viberoots/viberoots");
  if (!isRecognized) return false;
  const mutableNode = node as {
    lastModified?: number;
    lastModifiedDate?: string;
    narHash?: string;
    path: unknown;
    ref?: string;
    rev?: string;
    revCount?: number;
    type: unknown;
    url?: string;
  };
  mutableNode.type = "path";
  mutableNode.path = activeViberootsRoot;
  if (typeof metadata?.lastModified === "number") {
    mutableNode.lastModified = metadata.lastModified;
  }
  if (typeof metadata?.narHash === "string") mutableNode.narHash = metadata.narHash;
  delete mutableNode.lastModifiedDate;
  delete mutableNode.ref;
  delete mutableNode.rev;
  delete mutableNode.revCount;
  delete mutableNode.url;
  return true;
}

export async function rewriteTempViberootsLockInput(
  tmp: string,
  input: MaterializedPathInput,
): Promise<string[]> {
  const activeViberootsRoot = input.storePath;
  const touched: string[] = [];
  for (const lockPath of await candidateTempFlakeLockPaths(tmp)) {
    const text = await fsp.readFile(lockPath, "utf8").catch(() => "");
    if (!text) continue;
    let lock: any;
    try {
      lock = JSON.parse(text);
    } catch {
      continue;
    }
    const inputName = lock?.nodes?.root?.inputs?.viberoots || "viberoots";
    const node = lock?.nodes?.[inputName] || lock?.nodes?.viberoots || lock?.nodes?.viberootsInput;
    if (!node || typeof node !== "object") continue;
    const lockedChanged = rewriteViberootsLockEntry(node.locked, activeViberootsRoot, input.locked);
    const originalChanged = rewriteViberootsLockEntry(node.original, activeViberootsRoot);
    const changed = lockedChanged || originalChanged;
    if (!changed) continue;
    await fsp.writeFile(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
    touched.push(relFromTempRoot(tmp, lockPath));
  }
  return touched;
}

export async function tempViberootsRootIfPresent(tmp: string): Promise<string | null> {
  const candidate = path.join(tmp, "viberoots");
  if (
    (await pathExists(path.join(candidate, "flake.nix"))) &&
    (await pathExists(path.join(candidate, "build-tools", "tools", "dev", "zx-init.mjs")))
  ) {
    return candidate;
  }
  return null;
}

export async function seedStoreViberootsRootIfPresent(): Promise<string | null> {
  const seedPath = String(process.env.VBR_TEST_SEED_STORE_PATH || "").trim();
  if (!seedPath) return null;
  const candidate = path.join(seedPath, "viberoots");
  if (
    (await pathExists(path.join(seedPath, PREPARED_SEED_MARKER))) &&
    (await pathExists(path.join(candidate, "flake.nix"))) &&
    (await pathExists(path.join(candidate, "build-tools", "tools", "dev", "zx-init.mjs")))
  ) {
    return await fsp.realpath(candidate).catch(() => candidate);
  }
  return null;
}
