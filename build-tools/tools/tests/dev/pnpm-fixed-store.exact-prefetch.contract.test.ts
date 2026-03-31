#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("fixed pnpm-store builds use exact prefetched stores for offline validation", async () => {
  const exactStore = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
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
    !exactStore.includes("nix store add-path")
  ) {
    throw new Error(
      "exact-store.ts must prefetch exact stores and import them into /nix/store before nix builds",
    );
  }
  if (!lockfile.includes("withExactPrefetchedStore")) {
    throw new Error("lockfile.ts must continue exporting the exact-store helper");
  }

  const store = await fsp.readFile("build-tools/tools/nix/node-modules/store.nix", "utf8");
  if (!store.includes('builtins.getEnv "NIX_PNPM_EXACT_STORE"')) {
    throw new Error("store.nix must read the exact-store env for fixed pnpm-store builds");
  }
  if (!store.includes("builtins.storePath exactPrefetchedPath")) {
    throw new Error("store.nix must treat exact-store env values as existing /nix/store paths");
  }
  if (!store.includes("pnpm install (offline exact-store)")) {
    throw new Error("store.nix must validate exact prefetched stores offline");
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

  const nixConfig = await fsp.readFile("build-tools/tools/nix/flake/nix-config.nix", "utf8");
  if (!nixConfig.includes('"NIX_PNPM_EXACT_STORE"')) {
    throw new Error(
      "nix-config.nix must allow the exact-store env through impure flake evaluation",
    );
  }
});
