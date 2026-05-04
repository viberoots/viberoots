#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { FILTERED_FLAKE_RSYNC_EXCLUDES } from "../../dev/nix-build-filtered-flake-lib";

test("filtered flake snapshot excludes large generated artifacts", async () => {
  const updaterHelper = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/filtered-flake.ts",
    "utf8",
  );
  const helper = await fsp.readFile("build-tools/tools/dev/nix-build-filtered-flake.ts", "utf8");
  const required = [
    "coverage",
    ".clinic",
    ".turbo",
    ".cache",
    "pnpm-workspace.yaml",
    ".node_modules.lockfile-guard.*",
    "result-*",
  ];

  for (const token of required) {
    if (!updaterHelper.includes(`--exclude ${token}`)) {
      throw new Error(`update-pnpm-hash filtered snapshot must include --exclude ${token}`);
    }
    if (!FILTERED_FLAKE_RSYNC_EXCLUDES.includes(token)) {
      throw new Error(`nix-build-filtered-flake snapshot must include ${token}`);
    }
  }

  if (!helper.includes("nix build --impure")) {
    throw new Error(
      "nix-build-filtered-flake must use --impure so selected planner env reaches filtered flake builds",
    );
  }
});
