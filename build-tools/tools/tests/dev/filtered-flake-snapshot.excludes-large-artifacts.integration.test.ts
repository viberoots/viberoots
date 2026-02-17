#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("filtered flake snapshot excludes large generated artifacts", async () => {
  const lockfile = await fsp.readFile("build-tools/tools/dev/update-pnpm-hash/lockfile.ts", "utf8");
  const helper = await fsp.readFile("build-tools/tools/dev/nix-build-filtered-flake.ts", "utf8");
  const required = [
    "--exclude coverage",
    "--exclude .clinic",
    "--exclude .turbo",
    "--exclude .cache",
  ];

  for (const token of required) {
    if (!lockfile.includes(token)) {
      throw new Error(`lockfile filtered snapshot must include ${token}`);
    }
    if (!helper.includes(token)) {
      throw new Error(`nix-build-filtered-flake snapshot must include ${token}`);
    }
  }
});
