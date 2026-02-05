#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, exists } from "../lib/test-helpers";

async function readOrEmpty(p: string): Promise<string> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return "";
  }
}

async function removeGeneratedProviderOutputs(provDir: string): Promise<void> {
  const files = [
    "TARGETS.auto",
    "TARGETS.cpp.auto",
    "TARGETS.node.auto",
    "TARGETS.python.auto",
    "TARGETS.test.auto",
    "provider_index.bzl",
    "provider_index.json",
    "auto_map.bzl",
    "nix_attr_map.bzl",
  ];
  for (const f of files) {
    try {
      await fsp.rm(path.join(provDir, f), { force: true });
    } catch {}
  }
}

test("glue-pipeline: outputs identical to manual steps (with pnpm lockfile present)", async () => {
  await runInTemp("glue-pipeline-pnpm-lock", async (tmp, $) => {
    // Create a minimal importer with a pnpm-lock.yaml (content not parsed without yaml module)
    const impDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(impDir, { recursive: true });
    await fsp.writeFile(
      path.join(impDir, "package.json"),
      JSON.stringify({ name: "@repo/web", version: "0.0.0" }, null, 2),
      "utf8",
    );
    // Minimal valid structure to satisfy parser when yaml module is available
    const lockTxt = "importers:\n  .: {}\npackages: {}\n";
    await fsp.writeFile(path.join(impDir, "pnpm-lock.yaml"), lockTxt, "utf8");

    // Synthesize a minimal graph that references the importer lockfile label
    const graphPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    const nodes = [
      {
        name: "//projects/apps/web:app",
        labels: ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],
      },
    ];
    await fsp.writeFile(graphPath, JSON.stringify(nodes), "utf8");

    // Baseline: manual steps
    await $`node build-tools/tools/buck/sync-providers.ts`;
    await $`node build-tools/tools/buck/gen-provider-index.ts --out third_party/providers/provider_index.bzl`;
    await $`node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
    await $`node build-tools/tools/node/gen-workspace-map.ts`;
    await $`node build-tools/tools/buck/invalidation-report.ts --out build-tools/tools/buck/invalidation-report.txt`;

    const provDir = path.join(tmp, "third_party", "providers");
    const baseNodeTargets = await readOrEmpty(path.join(provDir, "TARGETS.node.auto"));
    const basePyTargets = await readOrEmpty(path.join(provDir, "TARGETS.python.auto"));
    const baseIndex = await readOrEmpty(path.join(provDir, "provider_index.bzl"));
    const baseMap = await readOrEmpty(path.join(provDir, "auto_map.bzl"));
    const baseWorkspaceMap = await readOrEmpty(
      path.join(tmp, "build-tools", "tools", "node", "workspace-map.json"),
    );
    const baseReport = await readOrEmpty(
      path.join(tmp, "build-tools", "tools", "buck", "invalidation-report.txt"),
    );

    // Clean outputs and rerun via pipeline
    await removeGeneratedProviderOutputs(provDir);
    try {
      await fsp.rm(path.join(tmp, "build-tools", "tools", "buck", "node-lock-index.json"), {
        force: true,
      });
    } catch {}
    try {
      await fsp.rm(path.join(tmp, "build-tools", "tools", "node", "workspace-map.json"), {
        force: true,
      });
    } catch {}
    try {
      await fsp.rm(path.join(tmp, "build-tools", "tools", "buck", "invalidation-report.txt"), {
        force: true,
      });
    } catch {}
    await $`node build-tools/tools/buck/glue-pipeline.ts`;

    const pipeNodeTargets = await readOrEmpty(path.join(provDir, "TARGETS.node.auto"));
    const pipePyTargets = await readOrEmpty(path.join(provDir, "TARGETS.python.auto"));
    const pipeIndex = await readOrEmpty(path.join(provDir, "provider_index.bzl"));
    const pipeMap = await readOrEmpty(path.join(provDir, "auto_map.bzl"));
    const pipeWorkspaceMap = await readOrEmpty(
      path.join(tmp, "build-tools", "tools", "node", "workspace-map.json"),
    );
    const pipeReport = await readOrEmpty(
      path.join(tmp, "build-tools", "tools", "buck", "invalidation-report.txt"),
    );

    function assertEqual(a: string, b: string, label: string) {
      if (a !== b) {
        console.error(`[mismatch] ${label}`);
        process.exit(2);
      }
    }
    assertEqual(baseNodeTargets, pipeNodeTargets, "TARGETS.node.auto");
    assertEqual(basePyTargets, pipePyTargets, "TARGETS.python.auto");
    assertEqual(baseIndex, pipeIndex, "provider_index.bzl");
    assertEqual(baseMap, pipeMap, "auto_map.bzl");
    assertEqual(baseWorkspaceMap, pipeWorkspaceMap, "workspace-map.json");
    assertEqual(baseReport, pipeReport, "invalidation-report.txt");

    // Sanity: ensure expected files exist
    for (const f of [
      "TARGETS.node.auto",
      "TARGETS.python.auto",
      "provider_index.bzl",
      "auto_map.bzl",
    ]) {
      const p = path.join(provDir, f);
      if (!(await exists(p))) {
        console.error("expected file missing:", f);
        process.exit(2);
      }
    }
    if (
      !(await exists(path.join(tmp, "build-tools", "tools", "buck", "invalidation-report.txt")))
    ) {
      console.error("expected file missing: invalidation-report.txt");
      process.exit(2);
    }
    if (!(await exists(path.join(tmp, "build-tools", "tools", "node", "workspace-map.json")))) {
      console.error("expected file missing: workspace-map.json");
      process.exit(2);
    }
  });
});
