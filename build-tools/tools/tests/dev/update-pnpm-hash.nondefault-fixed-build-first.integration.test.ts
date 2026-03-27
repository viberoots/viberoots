#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash nondefault importer verifies fixed build before unfixed rebuild", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash/nondefault.ts", "utf8");
  if (!txt.includes("step=fixed-build attr=${opts.storeAttr}")) {
    throw new Error("nondefault importer path must verify fixed build before unfixed rebuild");
  }
  if (
    !txt.includes(
      "buildStore(opts.storeAttr, `path:${opts.repoRoot}#pnpm`, verifyExistingActivity)",
    )
  ) {
    throw new Error("nondefault importer fixed-build verification must use the current repo flake");
  }
  if (!txt.includes("const suggestedFromExisting = extractHash")) {
    throw new Error(
      "nondefault importer path must extract suggested hash from fixed-build failures",
    );
  }
  if (!txt.includes("step=fixed-build-after-hash attr=${opts.storeAttr}")) {
    throw new Error("nondefault importer path must retry fixed build after updating the hash");
  }
});
