#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("update-pnpm-hash uses filtered flake snapshots for non-default importer builds", async () => {
  const helper = await fsp.readFile(
    "viberoots/build-tools/tools/dev/update-pnpm-hash/build-flake.ts",
    "utf8",
  );
  if (!helper.includes("makeFilteredFlakeRef")) {
    throw new Error(
      "build-flake.ts must create filtered flake snapshots for non-default importer builds",
    );
  }
  if (!helper.includes("step=prepare-filtered-flake")) {
    throw new Error("build-flake.ts must log filtered flake preparation when it is in use");
  }
  if (!helper.includes('if (opts.importer === ".")')) {
    throw new Error(
      "build-flake.ts must keep the default importer on the existing direct flake path",
    );
  }
  if (!helper.includes('filtered.flakeRef.endsWith("#pnpm")')) {
    throw new Error(
      "build-flake.ts must validate the filtered pnpm flake contract before stripping #pnpm",
    );
  }
});
