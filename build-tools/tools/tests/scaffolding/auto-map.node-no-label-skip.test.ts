#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("auto-map skips targets without lockfile labels", async () => {
  await runInTemp("auto-map-skip", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    // Create graph with targets that have NO lockfile labels
    const graphPath = path.join(tmp, "build-tools/tools/buck/graph.json");
    const graphContent = JSON.stringify([
      {
        name: "//apps/go-only:service",
        rule_type: "go_binary",
        labels: ["module:github.com/example/lib@v1.0.0", "lang:go"],
        srcs: ["main.go"],
        deps: [],
      },
      {
        name: "//libs/cpp-only:lib",
        rule_type: "cxx_library",
        labels: ["nixpkg:pkgs.zlib", "lang:cpp"],
        srcs: ["lib.cpp"],
        deps: [],
      },
      {
        name: "//apps/node:bundle",
        rule_type: "genrule",
        labels: ["lockfile:apps/node/pnpm-lock.yaml#apps/node", "lang:node"],
        srcs: ["index.ts"],
        deps: [],
      },
    ]);

    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(graphPath, graphContent, "utf8");

    // Create lockfile only for the node target
    const lockfilePath = path.join(tmp, "apps/node/pnpm-lock.yaml");
    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(
      lockfilePath,
      `lockfileVersion: "9.0"\nimporters:\n  apps/node:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await $`git add apps/node/pnpm-lock.yaml`;

    // Generate providers
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    // Generate auto-map
    const autoMapPath = path.join(tmp, "third_party/providers/auto_map.bzl");
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${autoMapPath}`;

    const autoMapContent = await fsp.readFile(autoMapPath, "utf8");

    // Verify MODULE_PROVIDERS exists
    if (!autoMapContent.includes("MODULE_PROVIDERS")) {
      console.error("Expected MODULE_PROVIDERS dict");
      process.exit(2);
    }

    // Only the node target should have a lockfile provider
    // Go and C++ targets should either be absent or have only their respective providers

    // Node target should be present with lockfile provider
    if (!autoMapContent.includes("//apps/node:bundle")) {
      console.error("Expected //apps/node:bundle in auto_map");
      process.exit(2);
    }

    const nodeBundleMatch = autoMapContent.match(/"\/\/apps\/node:bundle":\s*\[([\s\S]*?)\]/);
    if (nodeBundleMatch && nodeBundleMatch[1].includes("lf_")) {
      // Good - has lockfile provider
    } else {
      console.error("Expected lockfile provider for //apps/node:bundle");
      process.exit(2);
    }

    // Go target should NOT have a lockfile provider (only module provider)
    if (autoMapContent.includes("//apps/go-only:service")) {
      const goMatch = autoMapContent.match(/"\/\/apps\/go-only:service":\s*\[([\s\S]*?)\]/);
      if (goMatch && goMatch[1].includes("lf_")) {
        console.error("Go target should not have lockfile provider");
        process.exit(2);
      }
    }
  });
});
