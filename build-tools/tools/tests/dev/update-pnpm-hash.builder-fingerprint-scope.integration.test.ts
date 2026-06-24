#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash builder fingerprint tracks pnpm-store inputs rather than updater helpers", async () => {
  const txt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
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
  if (!txt.includes("currentVerifiedMarkerFingerprintCandidates")) {
    throw new Error(
      "verified-marker.ts must accept the previous exact-store-provisioning fingerprint during migration",
    );
  }
});
