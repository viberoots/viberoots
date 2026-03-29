#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash nondefault importer verifies fixed build before unfixed rebuild", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash/nondefault.ts", "utf8");
  if (!txt.includes("step=fixed-build attr=${opts.storeAttr}")) {
    throw new Error("nondefault importer path must verify fixed build before unfixed rebuild");
  }
  if (!txt.includes("const fixedFlakeRef = flakeRefForImporter(opts.repoRoot, opts.importer);")) {
    throw new Error("nondefault importer fixed-build verification must compute importer flake ref");
  }
  if (!txt.includes("buildStore(opts.storeAttr, fixedFlakeRef, verifyExistingActivity)")) {
    throw new Error(
      "nondefault importer fixed-build verification must use normalized importer flake ref",
    );
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
  if (!txt.includes("step=fixed-build-after-hash attr=${opts.storeAttr}")) {
    throw new Error("nondefault importer path must retry fixed build after updating the hash");
  }
});
