#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { providerNameForImporter } from "../lib/providers";
import { runInTemp } from "./lib/test-helpers";

test("auto-map includes importer-scoped provider for a temp projects/apps/example importer", async () => {
  await runInTemp("auto-map-node-example-wire", async (tmp, $) => {
    // Create a minimal projects/apps/example importer with lockfile and a Buck target that carries the lockfile label.
    await $`bash --noprofile --norc -c ${[
      "set -euo pipefail",
      "mkdir -p projects/apps/example third_party/providers build-tools/tools/buck",
      // Provide a minimal stub so Buck can load macros before glue is generated.
      "cat > third_party/providers/auto_map.bzl <<'BXL'",
      "# GENERATED (stub for tests) — will be replaced by gen-auto-map",
      "MODULE_PROVIDERS = {}",
      "BXL",
      // Minimal PNPM lockfile with one importer; contents need not be realistic for provider scanning
      "cat > projects/apps/example/pnpm-lock.yaml <<'YAML'",
      "lockfileVersion: '9.0'",
      "settings: {}",
      "importers:",
      "  projects/apps/example:",
      "    dependencies: {}",
      "    devDependencies: {}",
      "    packages: {}",
      "YAML",
      // Define a simple node gen target with the importer-scoped lockfile label, so auto-map has a node to attach mapping to
      "cat > projects/apps/example/TARGETS <<'ST'",
      'load("//build-tools/node:defs.bzl", "nix_node_gen")',
      "",
      "nix_node_gen(",
      '    name = "smoke_test",',
      '    labels = ["lockfile:projects/apps/example/pnpm-lock.yaml#projects/apps/example"],',
      '    out = "smoke.stamp",',
      '    cmd = "echo ok > $OUT",',
      ")",
      "ST",
      // Ensure the exporter includes our target in its deps(...) query by creating
      // a trivial root aggregator that depends on the smoke_test target.
      "cat >> TARGETS <<'ST'",
      'load("@prelude//:rules.bzl", "genrule")',
      "",
      "genrule(",
      '    name = "root_agg",',
      "    srcs = [],",
      '    out = "root_agg.stamp",',
      '    cmd = "echo ok > $OUT",',
      '    deps = ["//projects/apps/example:smoke_test"],',
      ")",
      "ST",
    ].join("\n")}`;

    const graph = "build-tools/tools/buck/graph.json";
    const NODE = "node";
    const ZX = path.resolve("build-tools/tools/dev/zx-init.mjs");
    const nodeFlags = [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      ZX,
    ];

    // Write a minimal graph.json with our Node target and importer-scoped label
    await fs.outputJSON(
      path.join(tmp, graph),
      [
        {
          name: "//projects/apps/example:smoke_test",
          rule_type: "genrule",
          labels: [
            "lockfile:projects/apps/example/pnpm-lock.yaml#projects/apps/example",
            "lang:node",
            "kind:test",
          ],
          srcs: [],
          deps: [],
        },
      ],
      { spaces: 2 },
    );
    // Generate Node providers from the lockfile
    await $`${NODE} ${nodeFlags} build-tools/tools/buck/sync-providers.ts --lang node --no-glue`;
    // Generate auto_map mapping lockfile label -> provider
    await $`${NODE} ${nodeFlags} build-tools/tools/buck/gen-auto-map.ts --graph ${graph} --out third_party/providers/auto_map.bzl`;

    const expected = `//third_party/providers:${providerNameForImporter(
      "projects/apps/example/pnpm-lock.yaml",
      "projects/apps/example",
    )}`;

    const autoMap = await fs.readFile(path.join(tmp, "third_party/providers/auto_map.bzl"), "utf8");
    // Look for mapping on the temp smoke_test target; allow config suffixes
    const hasSmokeTest =
      /".*projects\/apps\/example:smoke_test(?: \(config\/\/platforms:[^)]*\))?"/m.test(autoMap);
    assert.ok(hasSmokeTest, "projects/apps/example target key missing in auto_map.bzl");
    assert.ok(
      autoMap.includes(expected),
      `Expected provider ${expected} not found in auto_map.bzl`,
    );
  });
});
