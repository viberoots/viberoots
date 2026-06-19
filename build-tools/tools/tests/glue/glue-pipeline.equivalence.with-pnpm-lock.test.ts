#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_GRAPH_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_PATH,
  WORKSPACE_PROVIDER_DIR,
  providerAutoTargetsPath,
} from "../../lib/workspace-state-paths";
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
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    const nodes = [
      {
        name: "//projects/apps/web:app",
        labels: ["lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web"],
      },
    ];
    await fsp.writeFile(graphPath, JSON.stringify(nodes), "utf8");

    // Baseline: manual steps
    await $`node viberoots/build-tools/tools/buck/sync-providers.ts`;
    await $`node viberoots/build-tools/tools/buck/gen-provider-index.ts --out .viberoots/workspace/providers/provider_index.bzl`;
    await $`node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph ${DEFAULT_GRAPH_PATH} --out ${DEFAULT_AUTO_MAP_PATH}`;
    await $`node viberoots/build-tools/tools/node/gen-workspace-map.ts`;
    await $`node viberoots/build-tools/tools/buck/invalidation-report.ts --out ${DEFAULT_INVALIDATION_REPORT_PATH}`;

    const provDir = path.join(tmp, WORKSPACE_PROVIDER_DIR);
    const baseNodeTargets = await readOrEmpty(path.join(tmp, providerAutoTargetsPath("node")));
    const basePyTargets = await readOrEmpty(path.join(tmp, providerAutoTargetsPath("python")));
    const baseIndex = await readOrEmpty(path.join(tmp, DEFAULT_PROVIDER_INDEX_PATH));
    const baseMap = await readOrEmpty(path.join(tmp, DEFAULT_AUTO_MAP_PATH));
    const baseWorkspaceMap = await readOrEmpty(
      path.join(tmp, ".viberoots", "workspace", "node", "workspace-map.json"),
    );
    const baseReport = await readOrEmpty(path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH));

    // Clean outputs and rerun via pipeline
    await removeGeneratedProviderOutputs(provDir);
    try {
      await fsp.rm(path.join(tmp, DEFAULT_NODE_LOCK_INDEX_PATH), {
        force: true,
      });
    } catch {}
    try {
      await fsp.rm(path.join(tmp, ".viberoots", "workspace", "node", "workspace-map.json"), {
        force: true,
      });
    } catch {}
    try {
      await fsp.rm(path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH), {
        force: true,
      });
    } catch {}
    await $`node viberoots/build-tools/tools/buck/glue-pipeline.ts`;

    const pipeNodeTargets = await readOrEmpty(path.join(tmp, providerAutoTargetsPath("node")));
    const pipePyTargets = await readOrEmpty(path.join(tmp, providerAutoTargetsPath("python")));
    const pipeIndex = await readOrEmpty(path.join(tmp, DEFAULT_PROVIDER_INDEX_PATH));
    const pipeMap = await readOrEmpty(path.join(tmp, DEFAULT_AUTO_MAP_PATH));
    const pipeWorkspaceMap = await readOrEmpty(
      path.join(tmp, ".viberoots", "workspace", "node", "workspace-map.json"),
    );
    const pipeReport = await readOrEmpty(path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH));

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
    if (!(await exists(path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH)))) {
      console.error("expected file missing: invalidation-report.txt");
      process.exit(2);
    }
    if (!(await exists(path.join(tmp, ".viberoots", "workspace", "node", "workspace-map.json")))) {
      console.error("expected file missing: workspace-map.json");
      process.exit(2);
    }
  });
});
