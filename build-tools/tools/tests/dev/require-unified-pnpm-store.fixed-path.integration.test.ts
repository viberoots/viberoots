#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("require-unified-pnpm-store assembles from exact prefetched stores", async () => {
  const txt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/require-unified-pnpm-store.ts",
    "utf8",
  );
  if (!txt.includes("prepareExactPnpmStore")) {
    throw new Error("require-unified-pnpm-store must prepare exact prefetched stores");
  }
  if (!txt.includes("await mergePnpmStore(storeDir, unifyStore)")) {
    throw new Error(
      "require-unified-pnpm-store must merge exact prefetched stores into unifyStore",
    );
  }
  if (txt.includes("nix build --impure")) {
    throw new Error("require-unified-pnpm-store must not rebuild pnpm-store attrs during prewarm");
  }
});
