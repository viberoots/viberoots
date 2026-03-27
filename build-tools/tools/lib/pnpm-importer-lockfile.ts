import * as fsp from "node:fs/promises";
import path from "node:path";

import { syncSourcePnpmStoreIntoLocalPrefetch } from "../dev/update-pnpm-hash/prefetched-store.ts";
import { parsePnpmLock } from "./pnpm-lock.ts";
import { externalPnpmStateDirs, removeLegacyImporterPnpmState } from "./pnpm-state-paths.ts";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function keysOf(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
}

function sameKeySet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function readJson<T>(absPath: string): Promise<T> {
  const txt = await fsp.readFile(absPath, "utf8");
  return JSON.parse(txt) as T;
}

function lockfileLooksPlaceholder(doc: { packages?: Record<string, any> }): boolean {
  const pkgCount = Object.keys(doc.packages || {}).length;
  return pkgCount === 0;
}

export async function importerLockfileNeedsRegen(opts: {
  repoRootAbs: string;
  importerRel: string;
}): Promise<boolean> {
  const importerAbs = path.join(opts.repoRootAbs, opts.importerRel);
  const pkgJsonAbs = path.join(importerAbs, "package.json");
  const lockAbs = path.join(importerAbs, "pnpm-lock.yaml");

  const pkg = await readJson<PkgJson>(pkgJsonAbs);
  const doc = await parsePnpmLock(lockAbs);
  const importers = doc.importers || {};
  // Importer-local lockfiles use "." as the importer key.
  const imp =
    importers["."] || importers[opts.importerRel] || importers[`./${opts.importerRel}`] || {};

  const pkgDeps = keysOf(pkg.dependencies);
  const pkgDevDeps = keysOf(pkg.devDependencies);
  const pkgOptDeps = keysOf(pkg.optionalDependencies);
  const pkgPeerDeps = keysOf(pkg.peerDependencies);

  const lockDeps = keysOf((imp as any).dependencies);
  const lockDevDeps = keysOf((imp as any).devDependencies);
  const lockOptDeps = keysOf((imp as any).optionalDependencies);
  const lockPeerDeps = keysOf((imp as any).peerDependencies);

  const hasAnyPkgDeps =
    pkgDeps.length + pkgDevDeps.length + pkgOptDeps.length + pkgPeerDeps.length > 0;
  if (hasAnyPkgDeps && lockfileLooksPlaceholder(doc)) return true;

  if (!sameKeySet(pkgDeps, lockDeps)) return true;
  if (!sameKeySet(pkgDevDeps, lockDevDeps)) return true;
  if (!sameKeySet(pkgOptDeps, lockOptDeps)) return true;
  if (!sameKeySet(pkgPeerDeps, lockPeerDeps)) return true;

  return false;
}

export async function ensureImporterLockfileFresh(opts: {
  tmp: string;
  $: any;
  env?: Record<string, string>;
  importerRel: string;
  nixPnpmFetchTimeoutSecs: string;
}): Promise<void> {
  const lockAbs = path.join(opts.tmp, opts.importerRel, "pnpm-lock.yaml");
  const needsRegen = await importerLockfileNeedsRegen({
    repoRootAbs: opts.tmp,
    importerRel: opts.importerRel,
  }).catch(() => true);
  if (!needsRegen) return;
  const importerAbs = path.join(opts.tmp, opts.importerRel);
  await removeLegacyImporterPnpmState(importerAbs);
  const { homeDir, storeDir } = await externalPnpmStateDirs(importerAbs);

  await opts.$({
    stdio: "inherit",
    env: opts.env,
  })`bash --noprofile --norc -c 'set -euo pipefail; mkdir -p "${homeDir}" "${storeDir}"; export PNPM_HOME="${homeDir}"; env NIX_PNPM_ALLOW_GENERATE=1 NIX_PNPM_FETCH_TIMEOUT="${opts.nixPnpmFetchTimeoutSecs}" nix run --accept-flake-config "path:${opts.tmp}#pnpm" -- config set store-dir "${storeDir}"; env NIX_PNPM_ALLOW_GENERATE=1 NIX_PNPM_FETCH_TIMEOUT="${opts.nixPnpmFetchTimeoutSecs}" nix run --accept-flake-config "path:${opts.tmp}#pnpm" -- install --filter "./${opts.importerRel}" --lockfile-only --prod=false --ignore-scripts --lockfile-dir "./${opts.importerRel}" --dir "./${opts.importerRel}" --color never'`;
  await syncSourcePnpmStoreIntoLocalPrefetch(storeDir);

  await fsp.access(lockAbs);
}
