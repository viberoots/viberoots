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
    const impDir = path.join(tmp, "apps", "web");
    await fsp.mkdir(impDir, { recursive: true });
    // Minimal valid structure to satisfy parser when yaml module is available
    const lockTxt = "importers:\n  .: {}\npackages: {}\n";
    await fsp.writeFile(path.join(impDir, "pnpm-lock.yaml"), lockTxt, "utf8");

    // Synthesize a minimal graph that references the importer lockfile label
    const graphPath = path.join(tmp, "tools", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    const nodes = [
      {
        name: "//apps/web:app",
        labels: ["lockfile:apps/web/pnpm-lock.yaml#apps/web"],
      },
    ];
    await fsp.writeFile(graphPath, JSON.stringify(nodes), "utf8");

    // Baseline: manual steps
    await $`node tools/buck/sync-providers.ts`;
    await $`node tools/buck/gen-provider-index.ts --out third_party/providers/provider_index.bzl`;
    await $`node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;

    const provDir = path.join(tmp, "third_party", "providers");
    const baseNodeTargets = await readOrEmpty(path.join(provDir, "TARGETS.node.auto"));
    const basePyTargets = await readOrEmpty(path.join(provDir, "TARGETS.python.auto"));
    const baseIndex = await readOrEmpty(path.join(provDir, "provider_index.bzl"));
    const baseMap = await readOrEmpty(path.join(provDir, "auto_map.bzl"));

    // Clean outputs and rerun via pipeline
    await removeGeneratedProviderOutputs(provDir);
    await $`node tools/buck/glue-pipeline.ts`;

    const pipeNodeTargets = await readOrEmpty(path.join(provDir, "TARGETS.node.auto"));
    const pipePyTargets = await readOrEmpty(path.join(provDir, "TARGETS.python.auto"));
    const pipeIndex = await readOrEmpty(path.join(provDir, "provider_index.bzl"));
    const pipeMap = await readOrEmpty(path.join(provDir, "auto_map.bzl"));

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
  });
});
