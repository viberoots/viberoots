#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

test("prebuild-guard: local auto-fix runs when stale", async () => {
  await runInTemp("prebuild-fresh-local", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "node-lock-index.json"),
      "{}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "invalidation-report.txt"),
      "# invalidation-report\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "# generated\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "# generated\n",
      "utf8",
    );
    // Touch an input to be newer than outputs
    await fsp.appendFile(path.join(tmp, "TARGETS"), "# freshness input\n", "utf8");
    const graphEnv = await reconcileSyntheticGeneratedGraph(tmp);
    await $({
      cwd: tmp,
      stdio: "inherit",
      env: graphEnv,
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;
  });
});
