#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { exists, runInTemp } from "../lib/test-helpers";

test("prebuild-guard: detects stale node-lock-index.json vs graph.json", async () => {
  await runInTemp("prebuild-node-lock-stale", async (tmp, $) => {
    const providersDir = path.join(tmp, ".viberoots", "workspace", "providers");
    await fsp.mkdir(providersDir, { recursive: true });

    const graphPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    const sidecarPath = path.join(tmp, ".viberoots", "workspace", "buck", "node-lock-index.json");
    const invalidationReport = path.join(
      tmp,
      ".viberoots",
      "workspace",
      "buck",
      "invalidation-report.txt",
    );

    await fsp.symlink("/nix/store/viberoots-test-prelude/prelude", path.join(tmp, "prelude"));
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(sidecarPath, JSON.stringify({ index: {} }, null, 2) + "\n", "utf8");
    await fsp.writeFile(invalidationReport, "# invalidation-report\n", "utf8");
    await fsp.writeFile(
      graphPath,
      JSON.stringify(
        {
          nodes: [
            {
              name: "//projects/apps/demo:app",
              labels: ["lockfile:projects/apps/demo/pnpm-lock.yaml#projects/apps/demo"],
            },
          ],
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    await fsp.writeFile(
      path.join(providersDir, "auto_map.bzl"),
      "# gen\nMODULE_PROVIDERS = {}\n",
      "utf8",
    );
    await fsp.writeFile(path.join(providersDir, "TARGETS.node.auto"), "# generated\n", "utf8");

    // CI should fail due to stale sidecar
    let failed = false;
    try {
      await $({
        cwd: tmp,
        stdio: "inherit",
        env: { ...process.env, CI: "true" },
      })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;
    } catch {
      failed = true;
    }
    if (!failed) {
      console.error("expected CI mode to fail on stale node-lock-index.json");
      process.exit(2);
    }

    // Local run should auto-fix by regenerating glue
    await $({
      cwd: tmp,
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/prebuild-guard.ts`;
    if (!(await exists(sidecarPath))) {
      throw new Error("expected node-lock-index.json to exist after auto-fix");
    }
  });
});
