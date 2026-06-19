#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash builder fingerprint tracks pnpm-store inputs rather than updater helpers", async () => {
  const txt = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/verified-marker.ts",
    "utf8",
  );
  for (const rel of [
    "flake.lock",
    "viberoots/build-tools/tools/nix/flake/per-system-context.nix",
    "viberoots/build-tools/tools/nix/flake/packages/node-mods.nix",
    "viberoots/build-tools/tools/nix/node-modules/store.nix",
    "viberoots/build-tools/tools/nix/node-modules/modules.nix",
  ]) {
    if (!txt.includes(rel)) {
      throw new Error(`verified-marker.ts builder fingerprint must include ${rel}`);
    }
  }
  for (const rel of [
    "viberoots/build-tools/tools/dev/update-pnpm-hash.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/exact-store.ts",
    "viberoots/build-tools/tools/dev/update-pnpm-hash/nondefault.ts",
    "viberoots/build-tools/tools/lib/pnpm-state-paths.ts",
  ]) {
    if (txt.includes(rel)) {
      throw new Error(
        `verified-marker.ts builder fingerprint must not include updater helper ${rel}`,
      );
    }
  }
});
