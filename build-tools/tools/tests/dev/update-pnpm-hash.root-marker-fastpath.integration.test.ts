#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash root importer uses strict marker fast-path", async () => {
  const mainTxt = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash.ts", "utf8");
  const markerTxt = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
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
  if (!mainTxt.includes("marker.hashValue === existingHash")) {
    throw new Error(
      "update-pnpm-hash.ts root fast-path must verify marker hash matches lockfile hash entry",
    );
  }
  if (!mainTxt.includes("marker.builderFingerprint === builderFingerprint")) {
    throw new Error(
      "update-pnpm-hash.ts root fast-path must invalidate when builder fingerprint changes",
    );
  }
  if (!markerTxt.includes("currentVerifiedMarkerFingerprint")) {
    throw new Error("verified-marker.ts must expose a builder fingerprint helper");
  }
});
