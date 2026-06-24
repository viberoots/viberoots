#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash root importer uses strict marker fast-path", async () => {
  const mainTxt = await fsp.readFile("viberoots/build-tools/tools/dev/update-pnpm-hash.ts", "utf8");
  const markerTxt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
    "utf8",
  );
  if (!markerTxt.includes("pnpm-store-verified.${key}.json")) {
    throw new Error("verified-marker.ts must persist root verified marker");
  }
  if (!markerTxt.includes('importer === "." ? "root"')) {
    throw new Error("verified-marker.ts marker naming must include root importer key");
  }
  if (!mainTxt.includes("step=skip-root-marker")) {
    throw new Error("update-pnpm-hash.ts must log skip-root-marker on strict fast-path");
  }
  if (mainTxt.includes("step=skip-root-marker-verify")) {
    throw new Error("update-pnpm-hash.ts must not rebuild on a matching root marker fast-path");
  }
  if (mainTxt.includes("step=skip-root-marker-after-hash")) {
    throw new Error(
      "update-pnpm-hash.ts must not refresh hashes on a matching root marker fast-path",
    );
  }
  if (!mainTxt.includes("marker.hashValue === existingHash")) {
    throw new Error(
      "update-pnpm-hash.ts root fast-path must verify marker hash matches lockfile hash entry",
    );
  }
  if (!mainTxt.includes("acceptedBuilderFingerprints.includes(marker.builderFingerprint)")) {
    throw new Error(
      "update-pnpm-hash.ts root fast-path must accept only current builder fingerprint candidates",
    );
  }
  if (!markerTxt.includes("currentVerifiedMarkerFingerprintCandidates")) {
    throw new Error(
      "verified-marker.ts must expose migration-aware builder fingerprint candidates",
    );
  }
  if (!markerTxt.includes("currentVerifiedMarkerFingerprint")) {
    throw new Error("verified-marker.ts must expose a builder fingerprint helper");
  }
  for (const rel of [
    "viberoots/build-tools/tools/nix/node-modules/common.nix",
    "viberoots/build-tools/tools/nix/node-modules/store.nix",
    "viberoots/build-tools/tools/nix/node-modules/modules.nix",
  ]) {
    if (!markerTxt.includes(rel)) {
      throw new Error(`verified-marker.ts must still invalidate for real builder input ${rel}`);
    }
  }
});
