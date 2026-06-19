#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { ensureBuckConfigForTempRepo } from "../lib/test-helpers/buck-config";

test("prebuild-guard: clean present outputs passes locally", async () => {
  await runInTemp("prebuild-clean", async (tmp, $) => {
    await ensureBuckConfigForTempRepo(tmp, $);
    const providersDir = path.join(tmp, ".viberoots", "workspace", "providers");
    const buckDir = path.join(tmp, ".viberoots", "workspace", "buck");
    await fsp.mkdir(providersDir, { recursive: true });
    await fsp.mkdir(buckDir, { recursive: true });
    await fsp.writeFile(path.join(buckDir, "graph.json"), "[]", "utf8");
    await fsp.writeFile(path.join(buckDir, "node-lock-index.json"), "{}\n", "utf8");
    await fsp.writeFile(
      path.join(buckDir, "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      "# generated\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(path.join(providersDir, "TARGETS.auto"), "# generated\n", "utf8");
    await fsp.writeFile(path.join(providersDir, "nix_attr_map.bzl"), "NIX_ATTR_MAP = {}\n", "utf8");
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;
  });
});
