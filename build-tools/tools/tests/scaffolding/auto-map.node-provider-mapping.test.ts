#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("gen-auto-map correctly maps lockfile labels to Node providers", async () => {
  await runInTemp("auto-map-node", async (tmp, $) => {
    // Initialize git so git ls-files works
    await $`git init`;

    // Create synthetic graph.json with Node targets
    const graphPath = path.join(tmp, "build-tools/tools/buck/graph.json");
    const graphContent = JSON.stringify([
      {
        name: "//apps/web:bundle",
        rule_type: "genrule",
        labels: ["lockfile:apps/web/pnpm-lock.yaml#apps/web", "lang:node", "kind:bundle"],
        srcs: ["src/index.ts"],
        deps: [],
      },
      {
        name: "//apps/api:server",
        rule_type: "genrule",
        labels: ["lockfile:apps/api/pnpm-lock.yaml#apps/api", "lang:node", "kind:bin"],
        srcs: ["src/main.ts"],
        deps: [],
      },
    ]);

    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(graphPath, graphContent, "utf8");

    // Create matching lockfiles
    const webLockfile = path.join(tmp, "apps/web/pnpm-lock.yaml");
    const apiLockfile = path.join(tmp, "apps/api/pnpm-lock.yaml");

    await fsp.mkdir(path.dirname(webLockfile), { recursive: true });
    await fsp.mkdir(path.dirname(apiLockfile), { recursive: true });

    await fsp.writeFile(
      webLockfile,
      `lockfileVersion: "9.0"\nimporters:\n  apps/web:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await fsp.writeFile(
      apiLockfile,
      `lockfileVersion: "9.0"\nimporters:\n  apps/api:\n    dependencies: {}\npackages: {}`,
      "utf8",
    );
    await $`git add apps/web/pnpm-lock.yaml apps/api/pnpm-lock.yaml`;

    // Generate providers
    await $`node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;

    // Generate auto-map
    const autoMapPath = path.join(tmp, "third_party/providers/auto_map.bzl");
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${autoMapPath}`;

    const autoMapContent = await fsp.readFile(autoMapPath, "utf8");

    // Verify MODULE_PROVIDERS exists
    if (!autoMapContent.includes("MODULE_PROVIDERS")) {
      console.error("Expected MODULE_PROVIDERS dict in auto_map.bzl");
      process.exit(2);
    }

    // Verify both targets are mapped
    if (!autoMapContent.includes("//apps/web:bundle")) {
      console.error("Missing //apps/web:bundle in auto_map");
      process.exit(2);
    }

    if (!autoMapContent.includes("//apps/api:server")) {
      console.error("Missing //apps/api:server in auto_map");
      process.exit(2);
    }

    // Verify provider labels are fully qualified
    if (!autoMapContent.includes("//third_party/providers:lf_")) {
      console.error("Expected fully qualified provider labels");
      process.exit(2);
    }

    // Verify determinism
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph ${graphPath} --out ${autoMapPath}`;
    const autoMapContent2 = await fsp.readFile(autoMapPath, "utf8");

    if (autoMapContent !== autoMapContent2) {
      console.error("auto_map.bzl changed on second generation");
      process.exit(2);
    }
  });
});
