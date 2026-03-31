#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash nondefault importer verifies fixed build before unfixed rebuild", async () => {
  const mainTxt = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash.ts", "utf8");
  const txt = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash/nondefault.ts", "utf8");
  if (!txt.includes("step=fixed-build attr=${opts.storeAttr}")) {
    throw new Error("nondefault importer path must verify fixed build before unfixed rebuild");
  }
  if (!mainTxt.includes("withExactPrefetchedStore({ repoRoot, importer }")) {
    throw new Error(
      "root updater must prepare an exact pnpm store before fixed-build verification",
    );
  }
  if (!mainTxt.includes("buildStore(storeAttr, flakeRef, activity, extraEnv)")) {
    throw new Error(
      "root updater fixed-build verification must pass exact-store env into buildStore",
    );
  }
  if (!txt.includes("opts.runFixedBuild(")) {
    throw new Error("nondefault importer fixed-build verification must use the injected runner");
  }
  if (!txt.includes("const suggestedFromExisting = extractHash")) {
    throw new Error(
      "nondefault importer path must extract suggested hash from fixed-build failures",
    );
  }
  if (!txt.includes('suggestedHash = extractHash(String(verify.output || ""))')) {
    throw new Error(
      "nondefault importer path must extract a suggested hash from the first fixed-build failure",
    );
  }
  const fixedIdx = txt.indexOf(
    "step=fixed-build attr=${opts.storeAttr} timeout=${opts.timeoutSec}s",
  );
  const unfixedIdx = txt.indexOf(
    "step=unfixed-build attr=${opts.unfixedAttr} timeout=${opts.timeoutSec}s",
  );
  if (fixedIdx === -1 || unfixedIdx === -1 || fixedIdx > unfixedIdx) {
    throw new Error(
      "nondefault importer path must try the fixed build before falling back to the unfixed build",
    );
  }
  if (!txt.includes("opts.runUnfixedBuild(")) {
    throw new Error("nondefault importer path must use the injected unfixed-build runner");
  }
  if (!txt.includes("step=fixed-build-after-hash attr=${opts.storeAttr}")) {
    throw new Error("nondefault importer path must retry fixed build after updating the hash");
  }
});
