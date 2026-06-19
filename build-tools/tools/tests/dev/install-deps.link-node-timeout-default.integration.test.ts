#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("install-deps passes bounded default timeout to link-node", async () => {
  const depsMain = await fsp.readFile(
    "viberoots/build-tools/tools/dev/install/deps-main.ts",
    "utf8",
  );
  const needle = 'NIX_PNPM_FETCH_TIMEOUT: String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600")';
  const occurrences = depsMain.split(needle).length - 1;
  if (occurrences < 2) {
    throw new Error(
      "deps-main.ts must pass NIX_PNPM_FETCH_TIMEOUT=600 default to both update-pnpm-hash and link-node",
    );
  }
});
