#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";
import { providerNameForImporter } from "../lib/providers";

test("unsupported importer labels do not generate Node providers or auto-map entries", async () => {
  await runInTemp("auto-map-node-unsupported-importer-ignored", async (tmp, $) => {
    await $`bash --noprofile --norc -c ${[
      "set -euo pipefail",
      "mkdir -p third_party/providers build-tools/tools/buck third_party",
      // Provide a minimal stub so Buck macros can load even before glue is generated.
      "cat > third_party/providers/auto_map.bzl <<'BXL'",
      "# GENERATED (stub for tests) — will be replaced by gen-auto-map",
      "MODULE_PROVIDERS = {}",
      "BXL",
      // Unsupported importer lockfile location
      "cat > third_party/pnpm-lock.yaml <<'YAML'",
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies: {}",
      "YAML",
    ].join("\n")}`;

    const graph = "build-tools/tools/buck/graph.json";
    await fs.outputJSON(
      path.join(tmp, graph),
      [
        {
          name: "//third_party:bad_target",
          rule_type: "genrule",
          labels: ["lockfile:third_party/pnpm-lock.yaml#third_party", "lang:node", "kind:test"],
          srcs: [],
          deps: [],
        },
      ],
      { spaces: 2 },
    );

    const NODE = "node";
    const ZX = path.resolve("build-tools/tools/dev/zx-init.mjs");
    const nodeFlags = [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      ZX,
    ];

    await $`${NODE} ${nodeFlags} build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    await $`${NODE} ${nodeFlags} build-tools/tools/buck/gen-auto-map.ts --graph ${graph} --out third_party/providers/auto_map.bzl`;

    const forbiddenProvider = `//third_party/providers:${providerNameForImporter(
      "third_party/pnpm-lock.yaml",
      "third_party",
    )}`;

    const nodeTargets = await fs.readFile(
      path.join(tmp, "third_party/providers/TARGETS.node.auto"),
      "utf8",
    );
    assert.ok(
      !nodeTargets.includes('lockfile="third_party/pnpm-lock.yaml"'),
      "unexpected provider entry for unsupported importer lockfile",
    );
    assert.ok(
      !nodeTargets.includes(forbiddenProvider),
      "unexpected provider label for unsupported importer",
    );

    const autoMap = await fs.readFile(path.join(tmp, "third_party/providers/auto_map.bzl"), "utf8");
    assert.ok(
      !autoMap.includes(forbiddenProvider),
      "unexpected auto_map reference to provider for unsupported importer",
    );
    assert.ok(
      !/third_party:bad_target/m.test(autoMap),
      "unexpected auto_map entry for unsupported importer-labeled target",
    );
  });
});
