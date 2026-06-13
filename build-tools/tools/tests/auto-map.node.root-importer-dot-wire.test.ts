#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";
import { providerNameForImporter } from "../lib/providers";
import { providerAutoTargetsPath, workspaceProviderLabel } from "../lib/workspace-state-paths";

test("auto-map includes importer-scoped provider for a repo-root pnpm-lock.yaml importer '.'", async () => {
  await runInTemp("auto-map-node-root-importer-dot-wire", async (tmp, $) => {
    await $`bash --noprofile --norc -c ${[
      "set -euo pipefail",
      "mkdir -p apps/example .viberoots/workspace/providers .viberoots/workspace/buck third_party/providers",
      // Provide a minimal stub so Buck macros can load even before glue is generated.
      "cat > .viberoots/workspace/providers/auto_map.bzl <<'BXL'",
      "# GENERATED (stub for tests) — will be replaced by gen-auto-map",
      "MODULE_PROVIDERS = {}",
      "BXL",
      // Repo-root lockfile
      "cat > pnpm-lock.yaml <<'YAML'",
      "lockfileVersion: '9.0'",
      "importers:",
      "  .:",
      "    dependencies: {}",
      "YAML",
    ].join("\n")}`;

    const graph = ".viberoots/workspace/buck/graph.json";
    await fs.outputJSON(
      path.join(tmp, graph),
      [
        {
          name: "//projects/apps/example:smoke_test",
          rule_type: "genrule",
          labels: ["lockfile:pnpm-lock.yaml#.", "lang:node", "kind:test"],
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
    await $`${NODE} ${nodeFlags} build-tools/tools/buck/gen-auto-map.ts --graph ${graph} --out .viberoots/workspace/providers/auto_map.bzl`;

    const expected = workspaceProviderLabel(providerNameForImporter("pnpm-lock.yaml", "."));

    const autoMap = await fs.readFile(
      path.join(tmp, ".viberoots/workspace/providers/auto_map.bzl"),
      "utf8",
    );
    assert.ok(
      /".*apps\/example:smoke_test(?: \(config\/\/platforms:[^)]*\))?"/m.test(autoMap),
      "apps/example target key missing in auto_map.bzl",
    );
    assert.ok(
      autoMap.includes(expected),
      `Expected provider ${expected} not found in auto_map.bzl`,
    );

    const nodeTargets = await fs.readFile(path.join(tmp, providerAutoTargetsPath("node")), "utf8");
    assert.match(nodeTargets, /lockfile="pnpm-lock\.yaml"/);
    assert.match(nodeTargets, /importer="\."/);
  });
});
