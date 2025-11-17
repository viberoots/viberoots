#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";
import { providerNameForImporter } from "../lib/providers.ts";

test("auto-map includes importer-scoped provider for a temp apps/example importer", async () => {
  await runInTemp("auto-map-node-example-wire", async (tmp, $) => {
    // Create a minimal apps/example importer with lockfile and a Buck target that carries the lockfile label.
    await $`bash -lc ${[
      "set -euo pipefail",
      "mkdir -p apps/example third_party/providers tools/buck",
      // Minimal PNPM lockfile with one importer; contents need not be realistic for provider scanning
      "cat > apps/example/pnpm-lock.yaml <<'YAML'",
      "lockfileVersion: '9.0'",
      "settings: {}",
      "importers:",
      "  apps/example:",
      "    dependencies: {}",
      "    devDependencies: {}",
      "    packages: {}",
      "YAML",
      // Define a simple node gen target with the importer-scoped lockfile label, so auto-map has a node to attach mapping to
      "cat > apps/example/TARGETS <<'ST'",
      "load(\"//node:defs.bzl\", \"nix_node_gen\")",
      "",
      "nix_node_gen(",
      "    name = \"smoke_test\",",
      "    labels = [\"lockfile:apps/example/pnpm-lock.yaml#apps/example\"],",
      ")",
      "ST",
    ].join("\n")}`;

    const graph = "tools/buck/graph.json";
    const NODE = "node";
    const ZX = path.resolve("tools/dev/zx-init.mjs");
    const nodeFlags = [
      "--experimental-strip-types",
      "--disable-warning=ExperimentalWarning",
      "--import",
      ZX,
    ];

    // Export a configured graph that includes our temp target
    await $`${NODE} ${nodeFlags} tools/buck/export-graph.ts --out ${graph}`;
    // Generate Node providers from the lockfile
    await $`${NODE} ${nodeFlags} tools/buck/sync-providers-node.ts`;
    // Generate auto_map mapping lockfile label -> provider
    await $`${NODE} ${nodeFlags} tools/buck/gen-auto-map.ts --graph ${graph} --out third_party/providers/auto_map.bzl`;

    const expected = `//third_party/providers:${providerNameForImporter(
      "apps/example/pnpm-lock.yaml",
      "apps/example",
    )}`;

    const autoMap = await fs.readFile("third_party/providers/auto_map.bzl", "utf8");
    // Look for mapping on the temp smoke_test target; allow config suffixes
    const hasSmokeTest = /".*apps\/example:smoke_test(?: \(config\/\/platforms:[^)]*\))?"/m.test(
      autoMap,
    );
    assert.ok(hasSmokeTest, "apps/example target key missing in auto_map.bzl");
    assert.ok(autoMap.includes(expected), `Expected provider ${expected} not found in auto_map.bzl`);
  });
});
