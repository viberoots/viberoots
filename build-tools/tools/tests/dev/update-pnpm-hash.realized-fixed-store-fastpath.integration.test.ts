#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("update-pnpm-hash reuses realized fixed pnpm-store outputs before exact-store prep", async () => {
  const mainTxt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  const helperTxt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/realized-store.ts"),
    "utf8",
  );
  const storeTxt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/node-modules/store.nix"),
    "utf8",
  );
  if (!mainTxt.includes("withResolvedExactPrefetchedStore")) {
    throw new Error("update-pnpm-hash.ts must reuse realized fixed stores before exact-store prep");
  }
  if (
    !helperTxt.includes('"path-info"') ||
    !helperTxt.includes("step=realized-fixed-store") ||
    !helperTxt.includes("NIX_PNPM_EXACT_STORE: resolved.exactStorePath")
  ) {
    throw new Error(
      "realized-store.ts must probe realized fixed-store outputs and pass them through exact-store env",
    );
  }
  if (!storeTxt.includes('if [ -d "$EXACT_STORE_ROOT/store" ]; then')) {
    throw new Error("store.nix must accept realized fixed-store roots as exact-store inputs");
  }
});
