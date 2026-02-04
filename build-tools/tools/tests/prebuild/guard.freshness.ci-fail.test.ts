#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: CI fails when stale", async () => {
  await runInTemp("prebuild-fresh-ci", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "build-tools", "tools", "buck", "graph.json"), "[]", "utf8");
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "node-lock-index.json"),
      "{}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "build-tools", "tools", "buck", "invalidation-report.txt"),
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
    // Touch an input newer than outputs
    await fsp.writeFile(path.join(tmp, "TARGETS"), "# touch\n", "utf8");
    let failed = false;
    try {
      await $({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, CI: "true" },
      })`node build-tools/tools/buck/prebuild-guard.ts`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected CI mode to fail on stale glue");
      process.exit(2);
    }
  });
});
