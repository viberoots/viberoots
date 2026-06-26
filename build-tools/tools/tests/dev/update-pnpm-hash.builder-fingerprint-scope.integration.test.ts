#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash separates verified marker and shared-cache fingerprints", async () => {
  const txt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
    "utf8",
  );
  const updaterTxt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash.ts",
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
  ]) {
    if (!primaryList.includes(rel)) {
      throw new Error(`verified-marker.ts builder fingerprint must include ${rel}`);
    }
  }
  for (const rel of [
    "viberoots/build-tools/tools/dev/update-pnpm-hash.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/nondefault.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-fetch.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store-import.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/prefetched-store.ts",
    "viberoots/build-tools/tools/lib/pnpm-state-paths.ts",
  ]) {
    if (primaryList.includes(rel)) {
      throw new Error(
        `verified-marker.ts builder fingerprint must not include updater helper ${rel}`,
      );
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
  const sharedCacheFingerprintBody = txt.match(
    /export async function currentSharedPnpmStoreHashCacheFingerprint\([\s\S]*?return await verifiedMarkerFingerprintForFiles\(([\s\S]*?)\);\n}/,
  )?.[1];
  if (
    !sharedCacheFingerprintBody ||
    !sharedCacheFingerprintBody.includes("exactStoreProvisioningFingerprintFiles")
  ) {
    throw new Error(
      "shared pnpm-store hash cache keys must include exact-store provisioning helpers",
    );
  }
  const candidatesBody = txt.match(
    /export async function currentVerifiedMarkerFingerprintCandidates\([\s\S]*?\n}/,
  )?.[0];
  if (
    !candidatesBody ||
    !candidatesBody.includes("currentVerifiedMarkerFingerprint") ||
    !candidatesBody.includes("exactStoreProvisioningFingerprintFiles")
  ) {
    throw new Error(
      "verified marker candidates must accept the recent exact-store provisioning fingerprint during migration",
    );
  }
  if (!candidatesBody.includes("Array.from(new Set([current, exactStoreProvisioning]))")) {
    throw new Error("verified marker candidates must include current and exact-store fingerprints");
  }
  const persistCount = (updaterTxt.match(/persistVerifiedHash\(\{/g) || []).length;
  const sharedPersistCount = (updaterTxt.match(/sharedCacheBuilderFingerprint,/g) || []).length;
  if (persistCount === 0 || sharedPersistCount < persistCount + 1) {
    throw new Error(
      "all update-pnpm-hash persist/restore paths must use the shared-cache builder fingerprint",
    );
  }
});
