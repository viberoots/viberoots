#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("fixed pnpm-store builds use exact prefetched stores for offline validation", async () => {
  const exactStore = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "utf8",
  );
  const exactStoreCommand = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/exact-store-command.ts",
    "utf8",
  );
  const lockfile = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash/lockfile.ts", "utf8");
  if (!exactStore.includes("export async function withExactPrefetchedStore")) {
    throw new Error("lockfile.ts must expose an exact-store helper for fixed pnpm-store builds");
  }
  if (
    !exactStore.includes("fetch") ||
    !exactStore.includes("--frozen-lockfile") ||
    !exactStore.includes("--store-dir") ||
    !exactStore.includes("sharedExactPnpmStateRoot")
  ) {
    throw new Error("exact-store.ts must prefetch exact stores and reuse shared lock-hash caches");
  }
  if (!exactStore.includes('ensureNixStoreToolPathSync("pnpm")')) {
    throw new Error(
      "exact-store.ts must require a Nix-managed pnpm binary for exact-store fetches",
    );
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
  const toolPaths = await fsp.readFile("build-tools/tools/lib/tool-paths.ts", "utf8");
  if (!toolPaths.includes("required tool must resolve to /nix/store")) {
    throw new Error("tool-paths.ts must fail when a required tool resolves outside /nix/store");
  }
  if (!lockfile.includes("withExactPrefetchedStore")) {
    throw new Error("lockfile.ts must continue exporting the exact-store helper");
  }
  const pnpmStatePaths = await fsp.readFile("build-tools/tools/lib/pnpm-state-paths.ts", "utf8");
  if (
    !pnpmStatePaths.includes("sharedExactPnpmStateRootPath") ||
    !pnpmStatePaths.includes("export async function sharedExactPnpmStateRoot")
  ) {
    throw new Error(
      "pnpm-state-paths.ts must expose both read-only and provisioning exact-store path helpers",
    );
  }
  if (
    !exactStore.includes("runExactStoreCommand") ||
    !exactStoreCommand.includes("withHeartbeat")
  ) {
    throw new Error(
      "exact-store helpers must run exact-store stages through managed command helpers",
    );
  }
  const exactStoreImport = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/exact-store-import.ts",
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

  const store = await fsp.readFile("build-tools/tools/nix/node-modules/store.nix", "utf8");
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

  const nixBuildHelpers = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/nix.ts",
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

  const unified = await fsp.readFile("build-tools/tools/dev/require-unified-pnpm-store.ts", "utf8");
  if (!unified.includes("prepareExactPnpmStore")) {
    throw new Error(
      "require-unified-pnpm-store.ts must prepare exact stores before unified prewarm",
    );
  }
  if (unified.includes("nix build --impure")) {
    throw new Error(
      "require-unified-pnpm-store.ts must not rebuild fixed pnpm-store attrs during prewarm",
    );
  }
  const installPrewarm = await fsp.readFile(
    "build-tools/tools/dev/install/unified-pnpm-prewarm.ts",
    "utf8",
  );
  if (!installPrewarm.includes("[install-deps] unified pnpm prewarm failed")) {
    throw new Error("install-deps unified pnpm prewarm must be required in non-dry-run mode");
  }
  if (installPrewarm.includes("[install-deps] unified pnpm prewarm skipped:")) {
    throw new Error("install-deps must not silently skip failed unified pnpm prewarm");
  }

  const nixConfig = await fsp.readFile("build-tools/tools/nix/flake/nix-config.nix", "utf8");
  if (!nixConfig.includes('"NIX_PNPM_EXACT_STORE"')) {
    throw new Error(
      "nix-config.nix must allow the exact-store env through impure flake evaluation",
    );
  }
});
