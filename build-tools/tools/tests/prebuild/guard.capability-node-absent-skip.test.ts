#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("prebuild-guard: node sync is skipped when no pnpm-lock.yaml present", async () => {
  await runInTemp("prebuild-cap-node-skip", async (tmp, $) => {
    // Ensure no pnpm-lock.yaml exists anywhere
    // Create minimal Go-only repo so glue runs
    await fsp.mkdir(path.join(tmp, ".viberoots", "workspace", "buck"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, ".viberoots", "workspace", "buck", "graph.json"),
      "[]",
      "utf8",
    );
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
    // Run prebuild-guard auto-fix path; should not error even without pnpm-lock.yaml
    await $({
      cwd: tmp,
      stdio: "inherit",
    })`node viberoots/build-tools/tools/buck/prebuild-guard.ts`;
  });
});
