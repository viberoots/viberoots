import * as fsp from "node:fs/promises";
import path from "node:path";
import { externalNodeToolEnv } from "./external-node-env";

import {
  syncLocalPrefetchIntoPnpmStore,
  syncSourcePnpmStoreIntoLocalPrefetch,
} from "../dev/update-pnpm-hash/prefetched-store";
import { preferredPnpmStoreDir } from "../dev/update-pnpm-hash/lockfile-shared";
import { withHiddenNodeModules } from "./pnpm-node-modules-guard";
import { parsePnpmLock } from "./pnpm-lock";
import { externalPnpmStateDirs, removeLegacyImporterPnpmState } from "./pnpm-state-paths";

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const GENERATED_WORKSPACE_OVERRIDES = {
  nanoid: "3.3.11",
} as const;

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

function isWithin(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

async function isCompleteWorkspaceLink(opts: {
  repoRootAbs: string;
  importerAbs: string;
  dependencyName: string;
  requested: unknown;
  resolved: unknown;
}): Promise<boolean> {
  if (typeof opts.requested !== "string" || !opts.requested.startsWith("workspace:")) {
    return false;
  }
  if (!opts.resolved || typeof opts.resolved !== "object") return false;
  const entry = opts.resolved as { specifier?: unknown; version?: unknown };
  if (entry.specifier !== opts.requested) return false;
  if (typeof entry.version !== "string" || !entry.version.startsWith("link:")) return false;

  const repoRoot = await fsp.realpath(opts.repoRootAbs).catch(() => path.resolve(opts.repoRootAbs));
  const linkedPath = path.resolve(opts.importerAbs, entry.version.slice("link:".length));
  const linkedRoot = await fsp.realpath(linkedPath).catch(() => "");
  if (!linkedRoot || !isWithin(repoRoot, linkedRoot)) return false;

  const linkedPackage = await readJson<{ name?: unknown }>(
    path.join(linkedRoot, "package.json"),
  ).catch(() => null);
  return linkedPackage?.name === opts.dependencyName;
}

async function emptyPackageGraphIsCompleteForWorkspaceLinks(opts: {
  repoRootAbs: string;
  importerAbs: string;
  pkg: PkgJson;
  importer: Record<string, any>;
}): Promise<boolean> {
  const groups = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const;
  for (const group of groups) {
    const requested = opts.pkg[group] || {};
    const resolved = opts.importer[group] || {};
    for (const [dependencyName, specifier] of Object.entries(requested)) {
      if (
        !(await isCompleteWorkspaceLink({
          repoRootAbs: opts.repoRootAbs,
          importerAbs: opts.importerAbs,
          dependencyName,
          requested: specifier,
          resolved: resolved[dependencyName],
        }))
      ) {
        return false;
      }
    }
  }
  return true;
}

async function hasLocalWorkspaceFile(importerAbs: string): Promise<boolean> {
  return await fsp
    .access(path.join(importerAbs, "pnpm-workspace.yaml"))
    .then(() => true)
    .catch(() => false);
}

function generatedWorkspaceOverridesMissing(doc: Record<string, any>): boolean {
  const overrides = doc.overrides || {};
  if (Object.keys(overrides).length === 0) return false;
  for (const [name, version] of Object.entries(GENERATED_WORKSPACE_OVERRIDES)) {
    if (overrides[name] !== version) return true;
  }
  return false;
}

async function activeViberootsOverride(repoRootAbs: string): Promise<string> {
  const candidates = [
    path.join(repoRootAbs, "viberoots"),
    path.join(repoRootAbs, ".viberoots", "current"),
  ];
  for (const candidate of candidates) {
    const abs = path.resolve(candidate);
    const hasFlake = await fsp
      .access(path.join(abs, "flake.nix"))
      .then(() => true)
      .catch(() => false);
    const hasZxInit = await fsp
      .access(path.join(abs, "build-tools", "tools", "dev", "zx-init.mjs"))
      .then(() => true)
      .catch(() => false);
    if (hasFlake && hasZxInit) {
      const real = await fsp.realpath(abs).catch(() => abs);
      return `path:${real}`;
    }
  }
  return "";
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

  if (!(await hasLocalWorkspaceFile(importerAbs)) && generatedWorkspaceOverridesMissing(doc)) {
    return true;
  }

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
  if (
    hasAnyPkgDeps &&
    lockfileLooksPlaceholder(doc) &&
    !(await emptyPackageGraphIsCompleteForWorkspaceLinks({
      repoRootAbs: opts.repoRootAbs,
      importerAbs,
      pkg,
      importer: imp as Record<string, any>,
    }))
  ) {
    return true;
  }

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
  const lockMissing = await fsp
    .access(lockAbs)
    .then(() => false)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return true;
      throw error;
    });
  const needsRegen =
    lockMissing ||
    (await importerLockfileNeedsRegen({
      repoRootAbs: opts.tmp,
      importerRel: opts.importerRel,
    }));
  if (!needsRegen) return;
  const importerAbs = path.join(opts.tmp, opts.importerRel);
  await removeLegacyImporterPnpmState(importerAbs);
  const { homeDir, storeDir: externalStoreDir } = await externalPnpmStateDirs(importerAbs);
  const { storeDir, usesSharedPrefetch } = preferredPnpmStoreDir(externalStoreDir);
  if (!usesSharedPrefetch) {
    await syncLocalPrefetchIntoPnpmStore(storeDir);
  }
  const viberootsOverride = await activeViberootsOverride(opts.tmp);

  await withHiddenNodeModules(importerAbs, async () => {
    await opts.$({
      stdio: "inherit",
      env: {
        ...externalNodeToolEnv(opts.env),
        VBR_PNPM_LOCKFILE_VIBEROOTS_OVERRIDE: viberootsOverride,
      },
    })`bash --noprofile --norc -c 'set -euo pipefail; vbr_override="\${VBR_PNPM_LOCKFILE_VIBEROOTS_OVERRIDE:-}"; vbr_override_args=(); if [[ -n "$vbr_override" ]]; then vbr_override_args=(--override-input viberoots "$vbr_override"); fi; mkdir -p "${homeDir}" "${storeDir}"; export PNPM_HOME="${homeDir}"; env NIX_PNPM_ALLOW_GENERATE=1 NIX_PNPM_FETCH_TIMEOUT="${opts.nixPnpmFetchTimeoutSecs}" nix run --accept-flake-config --no-write-lock-file "\${vbr_override_args[@]}" "path:${opts.tmp}#pnpm" -- config set store-dir "${storeDir}"; env NIX_PNPM_ALLOW_GENERATE=1 NIX_PNPM_FETCH_TIMEOUT="${opts.nixPnpmFetchTimeoutSecs}" nix run --accept-flake-config --no-write-lock-file "\${vbr_override_args[@]}" "path:${opts.tmp}#pnpm" -- install --force --filter "./${opts.importerRel}" --lockfile-only --prefer-offline --prod=false --ignore-scripts --lockfile-dir "./${opts.importerRel}" --dir "./${opts.importerRel}" --color never; env NIX_PNPM_ALLOW_GENERATE=1 NIX_PNPM_FETCH_TIMEOUT="${opts.nixPnpmFetchTimeoutSecs}" nix run --accept-flake-config --no-write-lock-file "\${vbr_override_args[@]}" "path:${opts.tmp}#pnpm" -- fetch --force --filter "./${opts.importerRel}" --prefer-offline --prod=false --lockfile-dir "./${opts.importerRel}" --dir "./${opts.importerRel}" --color never'`;
  });
  if (!usesSharedPrefetch) {
    await syncSourcePnpmStoreIntoLocalPrefetch(storeDir);
  }

  await fsp.access(lockAbs);
}
