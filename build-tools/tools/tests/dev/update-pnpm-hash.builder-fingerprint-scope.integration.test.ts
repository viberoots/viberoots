#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash keeps local marker fingerprints and exact shared derivation authority", async () => {
  const txt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
    "utf8",
  );
  const updaterTxt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash.ts",
    "utf8",
  );
  const reconciliationTxt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/fixed-store-reconcile.ts",
    "utf8",
  );
  const primaryList = txt.match(
    /const pnpmStoreBuilderFingerprintFiles = \[([\s\S]*?)\] as const;/,
  )?.[1];
  if (!primaryList) {
    throw new Error("verified-marker.ts must declare the primary pnpm-store builder inputs");
  }
  for (const rel of [
    "flake.lock",
    "viberoots/build-tools/tools/nix/flake/per-system-context.nix",
    "viberoots/build-tools/tools/nix/flake/packages/node-mods.nix",
    "viberoots/build-tools/tools/nix/node-modules/store.nix",
    "viberoots/build-tools/tools/nix/node-modules/modules.nix",
    "viberoots/build-tools/tools/nix/node-modules/supported-platforms.nix",
  ]) {
    if (!primaryList.includes(rel)) {
      throw new Error(`verified-marker.ts builder fingerprint must include ${rel}`);
    }
  }
  for (const rel of [
    "viberoots/build-tools/tools/dev/update-pnpm-hash.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/fixed-store-reconcile.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/nix.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/prefetched-store.ts",
    "viberoots/build-tools/tools/lib/pnpm-state-paths.ts",
  ]) {
    if (primaryList.includes(rel)) {
      throw new Error(
        `verified-marker.ts builder fingerprint must not include updater helper ${rel}`,
      );
    }
  }
  if (
    txt.includes("exactStoreProvisioningFingerprintFiles") ||
    txt.includes("currentVerifiedMarkerFingerprintCandidates")
  ) {
    throw new Error("verified markers must have one current fingerprint authority");
  }
  for (const deleted of ["nondefault.ts", "exact-store-fetch.ts", "exact-store-import.ts"]) {
    if (txt.includes(`update-pnpm-hash/${deleted}`)) {
      throw new Error(`verified-marker.ts must not fingerprint deleted helper ${deleted}`);
    }
  }
  const currentFingerprintBody = txt.match(
    /export async function currentVerifiedMarkerFingerprint\([\s\S]*?return await verifiedMarkerFingerprintForFiles\(([\s\S]*?)\);\n}/,
  )?.[1];
  if (
    !currentFingerprintBody ||
    !currentFingerprintBody.includes("pnpmStoreBuilderFingerprintFiles")
  ) {
    throw new Error("current verified markers must track pnpm-store builder inputs");
  }
  if (currentFingerprintBody.includes("exactStoreProvisioningFingerprintFiles")) {
    throw new Error(
      "current verified markers must not be invalidated by exact-store helper-only edits",
    );
  }
  if (txt.includes("currentSharedPnpmStoreHashCacheFingerprint")) {
    throw new Error("shared pnpm-store cache must not retain an approximate file fingerprint");
  }
  const sharedLockBody = txt.match(/export async function withSharedHashCacheLock[\s\S]*?\n}/)?.[0];
  if (
    !sharedLockBody ||
    !sharedLockBody.includes("const lockRoot = sharedPnpmStoreHashCacheRoot()") ||
    !sharedLockBody.includes("scopeRootAbs: lockRoot")
  ) {
    throw new Error(
      "shared pnpm-store authority must serialize equivalent temp repos through one global lock scope",
    );
  }
  const updateFlowTxt = `${updaterTxt}\n${reconciliationTxt}`;
  const persistCount = (updateFlowTxt.match(/persistVerifiedHash\(\{/g) || []).length;
  if (
    persistCount === 0 ||
    !updateFlowTxt.includes("authorityDerivationIdentity") ||
    !updateFlowTxt.includes("finalDerivationIdentity") ||
    !updateFlowTxt.includes("evaluatePnpmStoreDerivationIdentity")
  ) {
    throw new Error(
      "shared pnpm-store persist/restore must use exact evaluated derivation identities",
    );
  }
});
