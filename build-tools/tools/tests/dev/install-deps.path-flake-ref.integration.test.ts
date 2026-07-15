#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildToolsRoot } from "../../dev/dev-build/paths";
import { materializeFilteredViberootsSource } from "../../dev/filtered-flake-viberoots-input";
import { pnpmNixRunArgs } from "../../dev/update-pnpm-hash/importer-lockfile";
import { immutableViberootsInputFromFlakeFiles } from "../../dev/update-pnpm-hash/nix";
import { isCanonicalSha256SRI } from "../../lib/nix-sri";

const toolsRoot = buildToolsRoot(process.cwd());

async function read(rel: string): Promise<string> {
  return await fsp.readFile(path.join(toolsRoot, rel), "utf8");
}

test("install path selects flake refs by importer scope", async (t) => {
  const immutableInput = `/nix/store/${"a".repeat(32)}-source`;
  const immutableFlake = `viberoots.url = "path:${immutableInput}";\n`;
  const validNarHash = `sha256-${"A".repeat(43)}=`;
  const immutableLock = JSON.stringify({
    nodes: {
      root: { inputs: { viberoots: "viberoots" } },
      viberoots: {
        locked: { type: "path", path: immutableInput, narHash: validNarHash },
        original: { type: "path", path: immutableInput },
      },
    },
  });
  assert.equal(
    immutableViberootsInputFromFlakeFiles(immutableFlake, immutableLock),
    immutableInput,
  );
  assert.equal(isCanonicalSha256SRI(validNarHash), true);
  assert.equal(isCanonicalSha256SRI("sha256-abc="), false);
  assert.equal(isCanonicalSha256SRI(`sha512-${"A".repeat(43)}=`), false);
  assert.equal(isCanonicalSha256SRI(`sha256-${"A".repeat(42)}-=`), false);
  const malformedHashLock = JSON.stringify({
    nodes: {
      root: { inputs: { viberoots: "viberoots" } },
      viberoots: {
        locked: { type: "path", path: immutableInput, narHash: "sha256-abc=" },
        original: { type: "path", path: immutableInput },
      },
    },
  });
  assert.throws(
    () => immutableViberootsInputFromFlakeFiles(immutableFlake, malformedHashLock),
    /flake\.lock does not match immutable viberoots input/,
  );
  assert.throws(
    () =>
      immutableViberootsInputFromFlakeFiles(
        'viberoots.url = "path:/tmp/live-viberoots";\n',
        immutableLock,
      ),
    /invalid absolute viberoots flake input/,
  );
  assert.throws(
    () => immutableViberootsInputFromFlakeFiles(immutableFlake, '{"nodes":{}}'),
    /flake\.lock does not match immutable viberoots input/,
  );
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
  if (
    !importerLockfile.includes("makeFilteredFlakeRef({") ||
    !importerLockfile.includes('attr: "pnpm"') ||
    !importerLockfile.includes("flakeRef: filtered.flakeRef")
  ) {
    throw new Error(
      "importer lockfile generation must use one importer-scoped filtered snapshot for both Nix commands",
    );
  }
  if (
    !importerLockfile.includes("WORKSPACE_ROOT: filtered.workspaceRoot") ||
    !importerLockfile.includes("VBR_PNPM_FILTERED_SNAPSHOT_ROOT: filtered.workspaceRoot") ||
    importerLockfile.includes("BUCK_TEST_SRC: filtered.workspaceRoot")
  ) {
    throw new Error("filtered lock generation must keep command/test authority on the live repo");
  }
  if (
    !importerLockfile.includes("pnpmNixRunArgs(opts.flakeRef, args, nixEnv)") ||
    !importerLockfile.includes("await filtered.cleanup()")
  ) {
    throw new Error(
      "filtered lock generation must use canonical env-aware Nix args and clean up its owned snapshot",
    );
  }
  const authorityFixture = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-lock-authority-"));
  t.after(async () => await fsp.rm(authorityFixture, { recursive: true, force: true }));
  await fsp.mkdir(path.join(authorityFixture, "build-tools/tools/dev"), { recursive: true });
  await fsp.writeFile(path.join(authorityFixture, "flake.nix"), "{ outputs = _: {}; }\n");
  await fsp.writeFile(path.join(authorityFixture, "build-tools/tools/dev/zx-init.mjs"), "\n");
  const authority = (await materializeFilteredViberootsSource(authorityFixture)).storePath;
  const flakeRef = "path:/tmp/filtered-lock-input";
  assert.deepEqual(pnpmNixRunArgs(flakeRef, ["fetch"], { VIBEROOTS_FLAKE_INPUT_ROOT: authority }), [
    "--quiet",
    "run",
    "--accept-flake-config",
    "--no-write-lock-file",
    "--override-input",
    "viberoots",
    `path:${authority}`,
    flakeRef,
    "--",
    "fetch",
  ]);
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
  if (
    !hashNix.includes("extraEnv: commandEnv") ||
    !hashNix.includes("...activeViberootsOverride(opts.flakeRef, opts.extraEnv)")
  ) {
    throw new Error(
      "update-pnpm-hash nix build args must use the merged command environment for the viberoots override",
    );
  }
  if (
    !hashNix.includes("function flakeLocalViberootsSource(") ||
    !hashNix.includes("if (flakeLocalViberootsSource(flakeRef)) return [];")
  ) {
    throw new Error(
      "update-pnpm-hash nix builds must not override a valid flake-local viberoots input",
    );
  }
  if (!hashNix.includes("/^\\/nix\\/store\\/[a-z0-9]{32}-source$/")) {
    throw new Error("update-pnpm-hash must preserve a repaired immutable filtered viberoots input");
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
