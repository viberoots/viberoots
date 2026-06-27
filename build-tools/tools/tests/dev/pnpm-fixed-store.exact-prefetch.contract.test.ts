#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("fixed pnpm-store builds use exact prefetched stores for offline validation", async () => {
  const exactStore = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "utf8",
  );
  const exactStoreCommand = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-command.ts",
    "utf8",
  );
  const exactStoreFetch = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-fetch.ts",
    "utf8",
  );
  const lockfile = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/lockfile.ts",
    "utf8",
  );
  const lockfileShared = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/lockfile-shared.ts",
    "utf8",
  );
  if (!exactStore.includes("export async function withExactPrefetchedStore")) {
    throw new Error("lockfile.ts must expose an exact-store helper for fixed pnpm-store builds");
  }
  if (
    !exactStore.includes("fetchExactPnpmStore") ||
    !exactStore.includes("resolveFlakePnpmProgram") ||
    !exactStore.includes("resolveWorkspaceRootsSync") ||
    !exactStore.includes("tempViberootsRootFromEnv") ||
    !exactStore.includes("function canonicalFlakeRoot") ||
    !exactStore.includes("fs.realpathSync.native(abs)") ||
    !exactStore.includes("const flakeRoot = canonicalFlakeRoot(repoRoot)") ||
    !exactStore.includes(
      "opts.viberootsRoot || tempViberootsRootFromEnv() || roots.viberootsRoot",
    ) ||
    !exactStore.includes("#apps.${system}.pnpm.program") ||
    exactStore.includes("seedExactStoreFromUnifiedStore") ||
    exactStore.includes("mergePnpmStore") ||
    exactStore.includes("unified-pnpm-store") ||
    !exactStore.includes('["run", "--accept-flake-config", "--impure", `path:${flakeRoot}#pnpm`') ||
    !exactStore.includes('"--", "--version"') ||
    !exactStoreFetch.includes("pnpmPath: string") ||
    !exactStoreFetch.includes("command: opts.pnpmPath") ||
    !exactStoreFetch.includes("--frozen-lockfile") ||
    !exactStoreFetch.includes("--store-dir") ||
    !exactStore.includes("sharedExactPnpmStateRoot")
  ) {
    throw new Error(
      "exact-store.ts must realize and prefetch exact stores with a canonical flake pnpm program and reuse shared lock-hash caches",
    );
  }
  if (
    !exactStoreFetch.includes("isPnpmPostCompletionTermination") ||
    !exactStoreFetch.includes("signal=SIGKILL") ||
    !exactStoreFetch.includes("exactStoreLooksPopulated") ||
    !exactStoreFetch.includes("exact-store-offline-validate-after-termination") ||
    !exactStoreFetch.includes('"--offline"') ||
    !exactStoreFetch.includes("verified offline install after pnpm post-completion termination") ||
    exactStoreFetch.includes('store", "status')
  ) {
    throw new Error(
      "exact-store population must validate a complete offline install after pnpm post-completion termination",
    );
  }
  if (!exactStoreFetch.includes('"--reporter"') || !exactStoreFetch.includes('"silent"')) {
    throw new Error("exact-store population must disable pnpm progress output");
  }
  if (!exactStoreFetch.includes('fsp.rm(path.join(opts.importerAbs, "node_modules")')) {
    throw new Error("exact-store population must remove transient node_modules");
  }
  if (exactStore.includes("makeFilteredFlakeRef") || exactStore.includes("pnpmFlakeRef(")) {
    throw new Error("exact-store.ts must not route exact-store fetches through live pnpm flakes");
  }
  if (!exactStoreCommand.includes("runManagedCommand")) {
    throw new Error("exact-store helpers must continue running through managed command helpers");
  }
  if (!exactStoreCommand.includes('command: opts.command || "nix"')) {
    throw new Error("exact-store command helpers must support direct command execution");
  }
  if (!lockfile.includes("withExactPrefetchedStore")) {
    throw new Error("lockfile.ts must continue exporting the exact-store helper");
  }
  if (!lockfileShared.includes("function pnpmWorkspaceMarker")) {
    throw new Error("lockfile-shared.ts must keep importer-local workspace marker generation");
  }
  if (lockfileShared.includes('"overrides:"') || lockfileShared.includes("nanoid: 3.3.11")) {
    throw new Error(
      "importer-local exact-store workspace markers must not inject overrides that can diverge from frozen lockfiles",
    );
  }
  const pnpmStatePaths = await fsp.readFile(
    "viberoots/build-tools/tools/lib/pnpm-state-paths.ts",
    "utf8",
  );
  if (
    !pnpmStatePaths.includes("sharedExactPnpmStateRootPath") ||
    !pnpmStatePaths.includes("export async function sharedExactPnpmStateRoot")
  ) {
    throw new Error(
      "pnpm-state-paths.ts must expose both read-only and provisioning exact-store path helpers",
    );
  }
  if (
    (!exactStore.includes("runExactStoreCommand") &&
      !exactStoreFetch.includes("runExactStoreCommand")) ||
    !exactStoreCommand.includes("withHeartbeat")
  ) {
    throw new Error(
      "exact-store helpers must run exact-store stages through managed command helpers",
    );
  }
  const exactStoreImport = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-import.ts",
    "utf8",
  );
  if (!exactStoreImport.includes('"store", "add-path"')) {
    throw new Error("exact-store helpers must import prepared stores into /nix/store");
  }
  if (!exactStoreImport.includes('"store.tar"')) {
    throw new Error(
      "exact-store helpers must archive prepared stores before importing them into /nix/store",
    );
  }
  if (!exactStoreImport.includes("await fsp.rm(archiveDir, { recursive: true, force: true })")) {
    throw new Error("exact-store helpers must remove transient archive dirs after Nix import");
  }
  if (!exactStore.includes("removeRedundantLocalExactStoreDirs")) {
    throw new Error("exact-store prep must remove redundant local fetched stores after Nix import");
  }
  if (
    !exactStore.includes("pruneSupersededExactStoreForImporter") ||
    !exactStore.includes("sharedExactPnpmStateIndexPath")
  ) {
    throw new Error("exact-store prep must prune superseded per-importer lock-hash caches");
  }
  if (
    !pnpmStatePaths.includes("sharedExactPnpmStateIndexPath(repoRoot: string, importer: string)") ||
    !pnpmStatePaths.includes("`${stateKey(repoRoot)}--${sanitizeFragment(importer)}.json`") ||
    !exactStore.includes("repoRoot: path.resolve(repoRoot)")
  ) {
    throw new Error("exact-store pruning indexes must be scoped by exact repo root and importer");
  }

  const store = await fsp.readFile(
    "viberoots/build-tools/tools/nix/node-modules/store.nix",
    "utf8",
  );
  const modules = await fsp.readFile(
    "viberoots/build-tools/tools/nix/node-modules/modules.nix",
    "utf8",
  );
  const common = await fsp.readFile(
    "viberoots/build-tools/tools/nix/node-modules/common.nix",
    "utf8",
  );
  const graphGenerator = await fsp.readFile(
    "viberoots/build-tools/tools/nix/graph-generator.nix",
    "utf8",
  );
  const nodePlanner = await fsp.readFile(
    "viberoots/build-tools/tools/nix/planner/node.nix",
    "utf8",
  );
  const nodeWebappPlanner = await fsp.readFile(
    "viberoots/build-tools/tools/nix/planner/node-webapp.nix",
    "utf8",
  );
  const nodeAppPlanner = await fsp.readFile(
    "viberoots/build-tools/tools/nix/planner/node-app.nix",
    "utf8",
  );
  if (!store.includes('builtins.getEnv "NIX_PNPM_EXACT_STORE"')) {
    throw new Error("store.nix must read the exact-store env for fixed pnpm-store builds");
  }
  if (!store.includes("builtins.storePath exactPrefetchedPath")) {
    throw new Error("store.nix must consume exact-store inputs as realized /nix/store paths");
  }
  if (!store.includes("pnpm install (offline exact-store)")) {
    throw new Error("store.nix must validate exact prefetched stores offline");
  }
  if (!store.includes('if [ -f "$EXACT_STORE_ROOT/store.tar" ]; then')) {
    throw new Error("store.nix must accept archived exact-store inputs");
  }
  if (!store.includes("NIX_PNPM_EXACT_STORE must be a /nix/store path")) {
    throw new Error("store.nix must reject non-store exact-store paths");
  }
  const dontFixupMatches = store.match(/dontFixup = true;/g) ?? [];
  if (dontFixupMatches.length < 2) {
    throw new Error("store.nix must skip generic fixup work for both pnpm-store cache derivations");
  }
  if (!modules.includes('"$verDir/index.db"') || !modules.includes('"$verDir/projects"')) {
    throw new Error(
      "mkNodeModules must preserve pnpm v11 store metadata when seeding offline installs",
    );
  }
  for (const [label, source] of [
    ["store.nix", store],
    ["modules.nix", modules],
  ] as const) {
    if (source.includes('"overrides:"') || source.includes("nanoid: 3.3.11")) {
      throw new Error(
        `${label} must not inject lockfile-affecting overrides into generated workspace markers`,
      );
    }
    if (
      !source.includes("write_pnpm_workspace_marker") ||
      !source.includes("pnpm-workspace.source.yaml") ||
      !source.includes("workspace_config") ||
      !source.includes('search_dir="$(dirname "$search_dir")"') ||
      !source.includes('const out = ["packages:", "  - ./"]') ||
      !source.includes('const skipKeys = new Set(["packages", "supportedArchitectures"])') ||
      !source.includes("!skipKeys.has(key)")
    ) {
      throw new Error(
        `${label} must preserve importer workspace config while replacing package scope and supported architectures`,
      );
    }
    if (!source.includes("pnpmSupportedArchitectures")) {
      throw new Error(
        `${label} must keep platform selection pinned in generated workspace markers`,
      );
    }
  }
  if (
    !common.includes('impPnpmWsPath = srcBaseStr + "/" + importerDir + "/pnpm-workspace.yaml"') ||
    !common.includes('name = "importer-pnpm-workspace.yaml"') ||
    !common.includes("$imp_out_dir/pnpm-workspace.yaml")
  ) {
    throw new Error(
      "importerOnlySrc must preserve importer-local pnpm-workspace.yaml so frozen installs see the same lockfile-affecting config",
    );
  }
  if (
    !graphGenerator.includes("repoFsRoot = builtins.toPath repoRootStr") ||
    !nodePlanner.includes("repoFsRoot = ctx.repoFsRoot or repoStoreRoot") ||
    !nodeWebappPlanner.includes("repoRoot = repoStoreRoot") ||
    !nodeWebappPlanner.includes("repoFsRoot = repoFsRoot") ||
    !nodeAppPlanner.includes("repoRoot = repoStoreRoot") ||
    !nodeAppPlanner.includes("repoFsRoot = repoFsRoot")
  ) {
    throw new Error(
      "graph node planners must pass the active filesystem root to node-modules source filtering while keeping derivation src on the store root",
    );
  }

  const nixBuildHelpers = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/nix.ts",
    "utf8",
  );
  if (!nixBuildHelpers.includes("must be a /nix/store path")) {
    throw new Error("update-pnpm-hash nix helpers must reject non-store exact-store paths");
  }
  if (!nixBuildHelpers.includes("--print-build-logs")) {
    throw new Error("update-pnpm-hash nix helpers must stream builder logs for stall diagnosis");
  }
  if (!nixBuildHelpers.includes("VBR_STREAM_NIX_BUILD_LOGS")) {
    throw new Error(
      "update-pnpm-hash nix helpers must support explicit streaming of nix builder logs",
    );
  }
  if (!nixBuildHelpers.includes('VBR_STREAM_NIX_BUILD_LOGS || "").trim() === "1"')) {
    throw new Error(
      "update-pnpm-hash nix helpers must keep install-time nix build logs compact by default; set VBR_STREAM_NIX_BUILD_LOGS=1 to stream them",
    );
  }
  if (nixBuildHelpers.includes('"substituters"')) {
    throw new Error(
      "update-pnpm-hash fixed-store builds must not disable substituters; local builders are controlled separately",
    );
  }
  const verifiedMarker = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
    "utf8",
  );
  const primaryFingerprintList = verifiedMarker.match(
    /const pnpmStoreBuilderFingerprintFiles = \[([\s\S]*?)\] as const;/,
  )?.[1];
  if (!primaryFingerprintList) {
    throw new Error("pnpm-store builder fingerprint inputs must be declared");
  }
  for (const exactStoreProducer of [
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-fetch.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-import.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/prefetched-store.ts",
  ]) {
    if (primaryFingerprintList.includes(exactStoreProducer)) {
      throw new Error(
        `pnpm-store builder fingerprint must not include exact-store provisioning helper ${exactStoreProducer}`,
      );
    }
  }
  const currentFingerprintBody = verifiedMarker.match(
    /export async function currentVerifiedMarkerFingerprint\([\s\S]*?return await verifiedMarkerFingerprintForFiles\(([\s\S]*?)\);\n}/,
  )?.[1];
  const sharedCacheFingerprintBody = verifiedMarker.match(
    /export async function currentSharedPnpmStoreHashCacheFingerprint\([\s\S]*?return await verifiedMarkerFingerprintForFiles\(([\s\S]*?)\);\n}/,
  )?.[1];
  const candidatesBody = verifiedMarker.match(
    /export async function currentVerifiedMarkerFingerprintCandidates\([\s\S]*?\n}/,
  )?.[0];
  if (
    !currentFingerprintBody ||
    !currentFingerprintBody.includes("pnpmStoreBuilderFingerprintFiles") ||
    currentFingerprintBody.includes("exactStoreProvisioningFingerprintFiles") ||
    !sharedCacheFingerprintBody ||
    !sharedCacheFingerprintBody.includes("exactStoreProvisioningFingerprintFiles") ||
    !candidatesBody ||
    !candidatesBody.includes("currentVerifiedMarkerFingerprint") ||
    !candidatesBody.includes("exactStoreProvisioningFingerprintFiles")
  ) {
    throw new Error(
      "verified marker primary/cache fingerprints must separate pnpm-store builder inputs from exact-store provisioning inputs",
    );
  }
  if (
    verifiedMarker.includes("viberoots/build-tools/tools/dev/update-pnpm-hash/realized-store.ts")
  ) {
    throw new Error("pnpm-store builder fingerprint must not include realized-store helper");
  }
  const updatePnpmHash = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash.ts",
    "utf8",
  );
  const nondefault = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/nondefault.ts",
    "utf8",
  );
  if (
    !updatePnpmHash.includes("step=stale-builder-recompute") ||
    !nondefault.includes("step=stale-builder-recompute")
  ) {
    throw new Error(
      "update-pnpm-hash must recompute unfixed hashes when builder markers are stale",
    );
  }

  const unified = await fsp.readFile(
    "viberoots/build-tools/tools/dev/require-unified-pnpm-store.ts",
    "utf8",
  );
  if (!unified.includes("prepareExactPnpmStore")) {
    throw new Error(
      "require-unified-pnpm-store.ts must prepare exact stores before unified prewarm",
    );
  }
  if (
    !unified.includes("mergeExactStorePathIntoUnifiedStore") ||
    !unified.includes('"store.tar"') ||
    !unified.includes("tar -xf")
  ) {
    throw new Error(
      "require-unified-pnpm-store.ts must assemble unified prewarm from archived exact stores",
    );
  }
  if (unified.includes("nix build --impure")) {
    throw new Error(
      "require-unified-pnpm-store.ts must not rebuild fixed pnpm-store attrs during prewarm",
    );
  }
  const installPrewarm = await fsp.readFile(
    "viberoots/build-tools/tools/dev/install/unified-pnpm-prewarm.ts",
    "utf8",
  );
  if (!installPrewarm.includes("[install-deps] unified pnpm prewarm failed")) {
    throw new Error("install-deps unified pnpm prewarm must be required in non-dry-run mode");
  }
  if (installPrewarm.includes("[install-deps] unified pnpm prewarm skipped:")) {
    throw new Error("install-deps must not silently skip failed unified pnpm prewarm");
  }

  const nixConfig = await fsp.readFile(
    "viberoots/build-tools/tools/nix/flake/nix-config.nix",
    "utf8",
  );
  if (!nixConfig.includes('"NIX_PNPM_EXACT_STORE"')) {
    throw new Error(
      "nix-config.nix must allow the exact-store env through impure flake evaluation",
    );
  }
});
