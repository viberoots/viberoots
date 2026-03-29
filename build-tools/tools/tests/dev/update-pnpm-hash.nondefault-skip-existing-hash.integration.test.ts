#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash skips non-default recompute when existing hash is present", async () => {
  const mainTxt = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash.ts", "utf8");
  const nondefaultTxt = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/nondefault.ts",
    "utf8",
  );
  if (!mainTxt.includes("readNodeModulesHashForLockfile")) {
    throw new Error("update-pnpm-hash.ts must read existing lockfile hash before recompute");
  }
  if (!nondefaultTxt.includes("opts.existingMarker.hashValue === opts.existingHash")) {
    throw new Error(
      "nondefault.ts skip must validate marker hashValue against existing hash entry",
    );
  }
  if (!nondefaultTxt.includes("step=stale-existing-hash")) {
    throw new Error("nondefault.ts must log stale-existing-hash when marker validation fails");
  }
  if (nondefaultTxt.includes("step=verify-existing-hash")) {
    throw new Error(
      "nondefault.ts must not run speculative verify-existing-hash when marker validation fails",
    );
  }
  if (nondefaultTxt.includes("step=skip-verified-existing-hash")) {
    throw new Error(
      "nondefault.ts must not log skip-verified-existing-hash for stale non-default markers",
    );
  }
  if (!nondefaultTxt.includes("step=skip-existing-hash")) {
    throw new Error("nondefault.ts must log skip-existing-hash for non-default importers");
  }
  if (!nondefaultTxt.includes('const unfixedFlakeRef = fixedFlakeRef.replace(/#pnpm$/, "");')) {
    throw new Error(
      "nondefault.ts must derive the unfixed flake ref directly from the importer path flake",
    );
  }
  if (nondefaultTxt.includes("makeFilteredFlakeRef")) {
    throw new Error(
      "nondefault.ts must not create filtered-flake snapshots for non-default importer hash refresh",
    );
  }
  if (!nondefaultTxt.includes("buildStore(opts.storeAttr, fixedFlakeRef")) {
    throw new Error(
      "nondefault.ts must verify fixed store after hash updates using the importer path flake",
    );
  }
  if (nondefaultTxt.includes("deriving hash from unfixed build")) {
    throw new Error(
      "nondefault.ts must not silently fall back to unfixed hash derivation after hash writes",
    );
  }
});
