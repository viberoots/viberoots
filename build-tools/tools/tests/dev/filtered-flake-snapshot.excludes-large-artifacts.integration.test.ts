#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { FILTERED_FLAKE_RSYNC_EXCLUDES } from "../../dev/nix-build-filtered-flake-lib";

test("filtered flake snapshot excludes large generated artifacts", async () => {
  const updaterHelper = await fsp.readFile(
    "build-tools/tools/dev/update-pnpm-hash/filtered-flake.ts",
    "utf8",
  );
  const selectedHelper = await fsp.readFile("build-tools/tools/dev/filtered-flake.ts", "utf8");
  const helper = await fsp.readFile("build-tools/tools/dev/nix-build-filtered-flake.ts", "utf8");
  const required = [
    "coverage",
    ".clinic",
    ".turbo",
    ".cache",
    "pnpm-workspace.yaml",
    ".node_modules.lockfile-guard.*",
    ".*.tmp",
    ".*.ts.??????",
    "result-*",
  ];

  for (const token of required) {
    if (!FILTERED_FLAKE_RSYNC_EXCLUDES.includes(token)) {
      throw new Error(`nix-build-filtered-flake snapshot must include ${token}`);
    }
  }

  for (const [name, source] of [
    ["update-pnpm-hash filtered snapshot", updaterHelper],
    ["selected-build filtered snapshot", selectedHelper],
    ["nix-build-filtered-flake snapshot", helper],
  ] as const) {
    if (!source.includes("filteredFlakeRsyncExcludeArgs")) {
      throw new Error(`${name} must use the shared filtered-flake rsync excludes`);
    }
  }

  if (!helper.includes("build --impure")) {
    throw new Error(
      "nix-build-filtered-flake must use --impure so selected planner env reaches filtered flake builds",
    );
  }
  if (!helper.includes("process.env.NIX_BIN") || !helper.includes('resolveToolPathSync("nix")')) {
    throw new Error(
      "nix-build-filtered-flake must invoke an explicit nix binary path so minimal Buck test PATHs work",
    );
  }
});
