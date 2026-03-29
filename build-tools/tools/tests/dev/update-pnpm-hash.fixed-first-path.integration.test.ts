#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash uses importer-aware fast path and fixed-first root path", async () => {
  const mainFile = "build-tools/tools/dev/update-pnpm-hash.ts";
  const nondefaultFile = "build-tools/tools/dev/update-pnpm-hash/nondefault.ts";
  const mainTxt = await fsp.readFile(mainFile, "utf8");
  const nondefaultTxt = await fsp.readFile(nondefaultFile, "utf8");

  if (!mainTxt.includes("handleNonDefaultImporter")) {
    throw new Error("update-pnpm-hash.ts must route non-default importers through dedicated flow");
  }
  if (
    !nondefaultTxt.includes(
      "const fixedFlakeRef = flakeRefForImporter(opts.repoRoot, opts.importer);",
    )
  ) {
    throw new Error("nondefault.ts must compute importer flake refs for fixed-first verification");
  }
  if (!nondefaultTxt.includes("buildStore(opts.storeAttr, fixedFlakeRef")) {
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

  if (!mainTxt.includes("buildStore(storeAttr, flakeRef")) {
    throw new Error("update-pnpm-hash.ts must verify fixed store first for root importer");
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
});
