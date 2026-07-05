#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("update-pnpm-hash uses importer-aware fast path and fixed-first root path", async () => {
  const mainFile = viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash.ts");
  const nondefaultFile = viberootsSourcePath(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/nondefault.ts",
  );
  const nixFile = viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/nix.ts");
  const exactStoreFile = viberootsSourcePath(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
  );
  const importerLockfileFile = viberootsSourcePath(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/importer-lockfile.ts",
  );
  const scaffoldingLockfileFile = viberootsSourcePath(
    "viberoots/build-tools/tools/lib/pnpm-importer-lockfile.ts",
  );
  const tempBuckConfigFile = viberootsSourcePath(
    "viberoots/build-tools/tools/tests/lib/test-helpers/buck-config.ts",
  );
  const mainTxt = await fsp.readFile(mainFile, "utf8");
  const nondefaultTxt = await fsp.readFile(nondefaultFile, "utf8");
  const nixTxt = await fsp.readFile(nixFile, "utf8");
  const exactStoreTxt = await fsp.readFile(exactStoreFile, "utf8");
  const importerLockfileTxt = await fsp.readFile(importerLockfileFile, "utf8");
  const scaffoldingLockfileTxt = await fsp.readFile(scaffoldingLockfileFile, "utf8");
  const tempBuckConfigTxt = await fsp.readFile(tempBuckConfigFile, "utf8");

  if (!mainTxt.includes("handleNonDefaultImporter")) {
    throw new Error("update-pnpm-hash.ts must route non-default importers through dedicated flow");
  }
  if (!mainTxt.includes("withExactPrefetchedStore({ repoRoot, importer }")) {
    throw new Error(
      "update-pnpm-hash.ts must prepare an exact pnpm store for fixed-first verification",
    );
  }
  if (!nondefaultTxt.includes("opts.runFixedBuild(")) {
    throw new Error("nondefault.ts must verify the fixed store before falling back to unfixed");
  }
  if (!nondefaultTxt.includes('suggestedHash = extractHash(String(verify.output || ""))')) {
    throw new Error("nondefault.ts must parse a suggested hash from the first fixed-store failure");
  }
  if (!nondefaultTxt.includes("if (!suggestedHash) {")) {
    throw new Error("nondefault.ts must only compute an unfixed hash when no suggestion exists");
  }
  if (!nondefaultTxt.includes("restoreHashFromSharedCache")) {
    throw new Error("nondefault.ts must consult the shared lock-hash cache before rebuilding");
  }
  if (
    nondefaultTxt.indexOf("step=stale-builder-recompute") <
    nondefaultTxt.indexOf("return await withSharedHashComputation(async () => {")
  ) {
    throw new Error(
      "nondefault.ts must log stale-builder recompute only inside the actual recompute callback",
    );
  }

  if (!mainTxt.includes("withPnpmStoreBuildFlakeRef")) {
    throw new Error(
      "update-pnpm-hash.ts must choose an importer-safe build flake before fixed verification",
    );
  }
  if (!mainTxt.includes("withResolvedExactPrefetchedStore")) {
    throw new Error(
      "update-pnpm-hash.ts fixed-store verification must reuse realized pnpm-store outputs before exact prefetch",
    );
  }
  if (!mainTxt.includes("buildStore(storeAttr, buildFlakeRef")) {
    throw new Error("update-pnpm-hash.ts must verify fixed store first for root importer");
  }
  if (!mainTxt.includes("const nixEnv = { ...extraEnv, ...filteredEnv };")) {
    throw new Error(
      "update-pnpm-hash.ts must merge exact-store env into the filtered nix environment",
    );
  }
  if (!mainTxt.includes("buildUnfixedAndHash(unfixedAttr, buildFlakeRef, activity, nixEnv)")) {
    throw new Error(
      "update-pnpm-hash.ts must pass the exact-store env into unfixed fallback builds",
    );
  }
  if (!mainTxt.includes("if (verify.ok) {")) {
    throw new Error(
      "update-pnpm-hash.ts must short-circuit when fixed store already builds (root path)",
    );
  }
  if (!mainTxt.includes('let suggested = extractHash(verify.output || "");')) {
    throw new Error(
      "update-pnpm-hash.ts must parse suggested hash from fixed-store failure output",
    );
  }
  if (!mainTxt.includes("if (!suggested) {")) {
    throw new Error("update-pnpm-hash.ts must only compute unfixed hash when suggestion is absent");
  }
  if (!mainTxt.includes("restoreHashFromSharedCache")) {
    throw new Error(
      "update-pnpm-hash.ts must consult the shared lock-hash cache for root importer",
    );
  }
  if (
    mainTxt.indexOf("restoreHashFromSharedCache") > mainTxt.indexOf("step=stale-builder-recompute")
  ) {
    throw new Error(
      "update-pnpm-hash.ts must restore root shared-cache hits before stale-builder recompute",
    );
  }
  if (!nixTxt.includes('"--no-write-lock-file"')) {
    throw new Error("update-pnpm-hash nix builds must not mutate generated flake locks");
  }
  if (!exactStoreTxt.includes('path.basename(abs) === "flake.nix"')) {
    throw new Error("exact-store flake root resolution must accept flake.nix file paths");
  }
  if (!exactStoreTxt.includes('"--no-write-lock-file"')) {
    throw new Error("exact-store flake program probes must not mutate generated flake locks");
  }
  if (!importerLockfileTxt.includes('"--no-write-lock-file"')) {
    throw new Error("importer lockfile pnpm flake runs must not mutate generated flake locks");
  }
  if (!scaffoldingLockfileTxt.includes("--no-write-lock-file")) {
    throw new Error("scaffolding lockfile pnpm flake runs must not mutate generated flake locks");
  }
  if (
    !tempBuckConfigTxt.includes("const flakeRoot = path.dirname(flakePath)") ||
    !tempBuckConfigTxt.includes("--no-write-lock-file")
  ) {
    throw new Error("temp repo buck config Nix probes must use flake dirs without lock writes");
  }
});
