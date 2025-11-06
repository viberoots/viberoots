#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: fails when node-lock-index.json is missing (CI), warns locally", async () => {
  await runInTemp("prebuild-node-lock-missing", async (tmp, $) => {
    // Minimal glue outputs (graph + auto_map) present, sidecar intentionally missing
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(path.join(tmp, "tools", "buck", "graph.json"), "{\n}\n", "utf8");
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "# generated\n",
      "utf8",
    );

    // Local run in no-fix mode should not exit non-zero
    await $({
      cwd: tmp,
      stdio: "inherit",
      env: { ...process.env, PREBUILD_GUARD_NO_FIX: "1" },
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;

    // CI should fail on missing sidecar
    let failed = false;
    try {
      await $({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, CI: "true" },
      })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/prebuild-guard.ts`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected CI mode to fail when node-lock-index.json is missing");
      process.exit(2);
    }
  });
});
