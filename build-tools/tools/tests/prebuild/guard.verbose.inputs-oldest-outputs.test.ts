#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { reconcileSyntheticGeneratedGraph } from "../lib/generated-graph.fixture";

test("prebuild-guard: verbose lists newest inputs and oldest outputs (capped)", async () => {
  await runInTemp("prebuild-verbose-io", async (tmp, $) => {
    // Outputs
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
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "TARGETS.auto"),
      "# gen\n",
      "utf8",
    );
    // Inputs (multiple) to populate top-N lists
    await fsp.appendFile(path.join(tmp, "TARGETS"), "# freshness input\n", "utf8");
    await fsp.mkdir(path.join(tmp, "patches", "go"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "patches", "go", "example.com__mod@v0.0.9.patch"),
      "diff --git a/x b/x\n",
      "utf8",
    );
    const graphEnv = await reconcileSyntheticGeneratedGraph(tmp);
    // Run verbose with limit 2
    const { stdout, stderr } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...graphEnv, PREBUILD_GUARD_VERBOSE: "1", PREBUILD_GUARD_LIST_LIMIT: "2" },
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts --verbose --verbose-limit 2`;
    const out = String(stdout || "") + String(stderr || "");
    if (
      !out.includes("newer input:") &&
      !out.includes("older output:") &&
      !out.includes("missing output:")
    ) {
      console.error(out);
      throw new Error("expected verbose listings");
    }
  });
});
