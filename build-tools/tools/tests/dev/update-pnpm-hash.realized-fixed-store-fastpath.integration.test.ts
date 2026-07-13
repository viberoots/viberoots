#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("update-pnpm-hash probes the committed final pnpm store before fixed builds", async () => {
  const mainTxt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash.ts"),
    "utf8",
  );
  const helperTxt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/realized-store.ts"),
    "utf8",
  );
  const storeTxt = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/nix/node-modules/store.nix"),
    "utf8",
  );
  if (!mainTxt.includes("resolveFinalPnpmStore")) {
    throw new Error("update-pnpm-hash.ts must resolve final stores before fixed builds");
  }
  if (
    !helperTxt.includes('"path-info"') ||
    !helperTxt.includes("committed.expectedPath") ||
    helperTxt.includes("prepareFinalPnpmStore")
  ) {
    throw new Error("realized-store.ts must only probe and return the committed final store");
  }
  if (!storeTxt.includes("final fixed pnpm store is missing")) {
    throw new Error("store.nix must fail closed when the final store was not materialized");
  }
  if (storeTxt.includes("NIX_PNPM_EXACT_STORE"))
    throw new Error("store.nix retained exact env input");
});
