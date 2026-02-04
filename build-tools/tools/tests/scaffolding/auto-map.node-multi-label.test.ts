#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("auto-map maps only lockfile providers when both module + lockfile labels present", async () => {
  await runInTemp("auto-map-multi", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    // Create graph with target having both module and lockfile labels
    const graphPath = path.join(tmp, "build-tools/tools/buck/graph.json");
    const graphContent = JSON.stringify([
      {
        name: "//apps/hybrid:service",
        rule_type: "genrule",
        labels: [
          "module:github.com/example/lib@v1.0.0",
          "lockfile:apps/hybrid/pnpm-lock.yaml#apps/hybrid",
          "lang:go",
          "lang:node",
        ],
        srcs: ["main.go", "index.ts"],
        deps: [],
      },
    ]);

    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(graphPath, graphContent, "utf8");

    // Create lockfile
    const lockfilePath = path.join(tmp, "apps/hybrid/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(
      lockfilePath,
      `lockfileVersion: "9.0"\nimporters:\n  apps/hybrid:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await $`git add apps/hybrid/pnpm-lock.yaml`;

    // Generate Node providers
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    // Generate auto-map
    const autoMapPath = path.join(tmp, "third_party/providers/auto_map.bzl");
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${autoMapPath}`;

    const autoMapContent = await fsp.readFile(autoMapPath, "utf8");

    // Verify target is present
    if (!autoMapContent.includes("//apps/hybrid:service")) {
      console.error("Missing //apps/hybrid:service in auto_map");
      process.exit(2);
    }

    // Should have only lockfile provider (no module provider)
    // Extract the providers for this target
    const targetMatch = autoMapContent.match(/"\/\/apps\/hybrid:service":\s*\[([\s\S]*?)\]/);
    if (!targetMatch) {
      console.error("Could not find provider list for //apps/hybrid:service");
      process.exit(2);
    }

    const providersList = targetMatch[1];

    // Should NOT include Go module provider
    if (providersList.includes("mod_")) {
      console.error("Did not expect Go module provider (mod_) in list");
      process.exit(2);
    }

    // Should include Node lockfile provider
    if (!providersList.includes("lf_")) {
      console.error("Expected Node lockfile provider (lf_) in list");
      process.exit(2);
    }
  });
});
