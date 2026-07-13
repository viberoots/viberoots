#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildToolsRoot } from "../../dev/dev-build/paths";

const toolsRoot = buildToolsRoot(process.cwd());

async function read(rel: string): Promise<string> {
  return await fsp.readFile(path.join(toolsRoot, rel), "utf8");
}

test("install path selects flake refs by importer scope", async () => {
  const common = await read("tools/dev/install/common.ts");
  if (!common.includes("export function flakeRefForImporter(")) {
    throw new Error("common.ts must expose flakeRefForImporter");
  }
  if (!common.includes("export function workspaceFlakeRoot(")) {
    throw new Error("common.ts must expose workspaceFlakeRoot for strict consumer layouts");
  }
  if (!common.includes('path.join(root, ".viberoots", "workspace")')) {
    throw new Error("workspaceFlakeRoot must fall back to the hidden viberoots workspace flake");
  }
  if (!common.includes("return workspaceFlakeRef(repoOrWorkspaceRoot);")) {
    throw new Error(
      "flakeRefForImporter must resolve through workspaceFlakeRef instead of assuming root flake.nix",
    );
  }

  const depsMain = await read("tools/dev/install/deps-main.ts");
  if (!depsMain.includes("importer ${imp}: realizing and linking node_modules")) {
    throw new Error("deps-main.ts must delegate node_modules realization to link-node");
  }
  if (depsMain.includes("nix build ${flakeRef}#${attr}")) {
    throw new Error("deps-main.ts must not duplicate node-modules nix build before link-node");
  }
  if (!depsMain.includes("VBR_SKIP_FINAL_WORKSPACE_LOCK_REPAIR")) {
    throw new Error("deps-main.ts must support explicit final workspace lock repair opt-out");
  }
  if (!depsMain.includes("shouldRunFinalWorkspaceLockRepair()")) {
    throw new Error("deps-main.ts must centralize final workspace lock repair policy");
  }

  const linkNode = await read("tools/dev/install/link-node.ts");
  if (!linkNode.includes("const flakeRef = flakeRefForImporter(flakeRoot, importer);")) {
    throw new Error("link-node.ts must resolve the workspace flake by importer scope");
  }
  if (!linkNode.includes("makeFilteredFlakeRef(root, importer)")) {
    throw new Error("link-node.ts must use an importer-scoped filtered snapshot for builds");
  }
  if (!linkNode.includes("buildFlakeRefBase")) {
    throw new Error("link-node.ts must choose importer-scoped build flake base");
  }
  if (!linkNode.includes("#node-modules.${attr}")) {
    throw new Error("link-node.ts must build node-modules attrs through computed flake ref base");
  }

  const update = await read("tools/dev/update-pnpm-hash.ts");
  if (!update.includes("const flakeRef = flakeRefForImporter(repoRoot, importer);")) {
    throw new Error(
      "update-pnpm-hash.ts must derive flakeRef via flakeRefForImporter(repoRoot, importer)",
    );
  }

  const lockfileShared = await read("tools/dev/update-pnpm-hash/lockfile-shared.ts");
  if (!lockfileShared.includes('import { workspaceFlakeRef } from "../install/common";')) {
    throw new Error("lockfile-shared.ts must use the shared workspace flake resolver");
  }
  if (!lockfileShared.includes("return `${workspaceFlakeRef(repoRoot)}#pnpm`;")) {
    throw new Error("pnpmFlakeRef must target the resolved workspace flake, not the consumer root");
  }

  const importerLockfile = await read("tools/dev/update-pnpm-hash/importer-lockfile.ts");
  if (!importerLockfile.includes('"--override-input", "viberoots", opts.viberootsOverride')) {
    throw new Error("importer lockfile generation must override stale viberoots lock inputs");
  }
  if (
    !importerLockfile.includes('viberoots.url = "path:./viberoots-flake-input"') ||
    !importerLockfile.includes('return "";')
  ) {
    throw new Error(
      "importer lockfile generation must not override the active generated filtered viberoots input",
    );
  }
  if (!importerLockfile.includes('path.join(repoRoot, "viberoots")')) {
    throw new Error("importer lockfile generation must prefer the local viberoots checkout");
  }
  if (
    !importerLockfile.includes('resolveRepoNodeBin(opts.repoRoot, "prettier")') ||
    !importerLockfile.includes("formatImporterLockfile({ repoRoot: opts.repoRoot, importerAbs })")
  ) {
    throw new Error("importer lockfile generation must format pnpm-lock.yaml before hashing");
  }

  const sharedImporterLockfile = await read("tools/lib/pnpm-importer-lockfile.ts");
  if (!sharedImporterLockfile.includes("VBR_PNPM_LOCKFILE_VIBEROOTS_OVERRIDE")) {
    throw new Error("shared importer lockfile generation must pass a local viberoots override");
  }
  if (
    !sharedImporterLockfile.includes(
      'vbr_override_args=(--override-input viberoots "$vbr_override")',
    )
  ) {
    throw new Error(
      "shared importer lockfile generation must override stale viberoots lock inputs",
    );
  }

  const filteredCompat = await read("tools/dev/update-pnpm-hash/filtered-flake.ts");
  if (!filteredCompat.includes('".viberoots", "workspace", "flake.nix"')) {
    throw new Error("update-pnpm-hash filtered snapshots must support hidden workspace flakes");
  }
  if (!filteredCompat.includes("flakeRef: `path:${flakeDir}#${opts.attr}`")) {
    throw new Error("update-pnpm-hash filtered snapshots must return the resolved flake dir");
  }

  const hashNix = await read("tools/dev/update-pnpm-hash/nix.ts");
  if (!hashNix.includes("export async function buildStore(")) {
    throw new Error("update-pnpm-hash/nix.ts must export buildStore helper");
  }
  if (!hashNix.includes("flakeRef: string")) {
    throw new Error("update-pnpm-hash/nix.ts helpers must accept flakeRef parameter");
  }
  if (!hashNix.includes('return ["--override-input", "viberoots", `path:${real}`];')) {
    throw new Error("update-pnpm-hash nix builds must override stale viberoots lock inputs");
  }
  if (!hashNix.includes("...activeViberootsOverride(opts.flakeRef)")) {
    throw new Error("update-pnpm-hash nix build args must include the local viberoots override");
  }
  if (
    !hashNix.includes("function flakeLocalViberootsSource(") ||
    !hashNix.includes("if (flakeLocalViberootsSource(flakeRef)) return [];")
  ) {
    throw new Error(
      "update-pnpm-hash nix builds must not override a valid flake-local viberoots input",
    );
  }

  const nodeModulesBuild = await read("tools/dev/node-modules-build.ts");
  if (!nodeModulesBuild.includes("workspaceFlakeRoot")) {
    throw new Error("node-modules-build.ts must prefer the generated workspace flake");
  }
  if (!nodeModulesBuild.includes('"projects", "node-modules.hashes.json"')) {
    throw new Error("node-modules-build.ts must read project-owned node module hashes");
  }
  if (
    !nodeModulesBuild.includes("--override-input") ||
    !nodeModulesBuild.includes("viberootsOverrideArgs")
  ) {
    throw new Error("node-modules-build.ts must override stale viberoots lock inputs");
  }
});
