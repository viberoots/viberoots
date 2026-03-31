#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("filtered flake snapshot excludes large generated artifacts", async () => {
  const updaterHelper = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/filtered-flake.ts",
    "utf8",
  );
  const helper = await fsp.readFile("build-tools/tools/dev/nix-build-filtered-flake.ts", "utf8");
  const required = [
    "--exclude coverage",
    "--exclude .clinic",
    "--exclude .turbo",
    "--exclude .cache",
    "--exclude pnpm-workspace.yaml",
    "--exclude .node_modules.lockfile-guard.*",
    "--exclude result-*",
  ];

  for (const token of required) {
    if (!updaterHelper.includes(token)) {
      throw new Error(`update-pnpm-hash filtered snapshot must include ${token}`);
    }
    if (!helper.includes(token)) {
      throw new Error(`nix-build-filtered-flake snapshot must include ${token}`);
    }
  }

  if (!helper.includes("nix build --impure")) {
    throw new Error(
      "nix-build-filtered-flake must use --impure so selected planner env reaches filtered flake builds",
    );
  }
});
