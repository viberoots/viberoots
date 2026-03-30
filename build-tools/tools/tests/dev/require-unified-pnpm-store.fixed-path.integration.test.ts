#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("require-unified-pnpm-store assembles from fixed pnpm-store attrs", async () => {
  const txt = await fsp.readFile("build-tools/tools/dev/require-unified-pnpm-store.ts", "utf8");
  if (txt.includes("pnpm-store-unfixed.")) {
    throw new Error("require-unified-pnpm-store must not prewarm from pnpm-store-unfixed attrs");
  }
  if (
    !txt.includes('"pnpm-store.default"') ||
    !txt.includes("`pnpm-store.${sanitizeImporter(imp)}`")
  ) {
    throw new Error("require-unified-pnpm-store must assemble from fixed pnpm-store attrs");
  }
});
