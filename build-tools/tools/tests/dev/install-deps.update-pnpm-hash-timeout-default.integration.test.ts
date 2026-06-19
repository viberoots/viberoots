#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("install-deps passes bounded but non-flaky default timeout to update-pnpm-hash", async () => {
  const depsMain = await fsp.readFile(
    "viberoots/build-tools/tools/dev/install/deps-main.ts",
    "utf8",
  );
  if (
    !depsMain.includes(
      'NIX_PNPM_FETCH_TIMEOUT: String(process.env.NIX_PNPM_FETCH_TIMEOUT || "600")',
    )
  ) {
    throw new Error(
      "deps-main.ts must default NIX_PNPM_FETCH_TIMEOUT to 600s for update-pnpm-hash",
    );
  }
});
