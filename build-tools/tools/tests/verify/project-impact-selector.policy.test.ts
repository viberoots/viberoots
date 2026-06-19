#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { resolveProjectImpactSelection } from "../../lib/project-impact-selector";

type GraphNode = {
  name: string;
  deps: string[];
};

async function writeGraph(tmp: string, nodes: GraphNode[]): Promise<string> {
  const graphPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
  await fsp.mkdir(path.dirname(graphPath), { recursive: true });
  await fsp.writeFile(graphPath, JSON.stringify({ version: 1, nodes }, null, 2), "utf8");
  return graphPath;
}

test("project-impact: changed app selects only that app when no dependent projects exist", async () => {
  await runInTemp("verify-project-impact-single-app", async (tmp, $) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//workspace/apps/demo:app", deps: [] },
      { name: "//workspace/libs/shared:lib", deps: [] },
    ]);
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath,
      changedPaths: ["workspace/apps/demo/src/main.ts"],
      projectPrefixes: ["workspace/apps", "workspace/libs"],
    });

    assert.equal(result.mode, "project-impact");
    assert.deepEqual(result.diagnostics.changedProjects, ["workspace/apps/demo"]);
    assert.deepEqual(result.diagnostics.dependentProjects, []);
    assert.deepEqual(result.targets, ["//workspace/apps/demo/..."]);
  });
});

test("project-impact: changed lib includes full recursive downstream dependent closure", async () => {
  await runInTemp("verify-project-impact-lib-closure", async (tmp, $) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//workspace/libs/core:lib", deps: [] },
      { name: "//workspace/apps/a:app", deps: ["//workspace/libs/core:lib"] },
      { name: "//workspace/apps/b:app", deps: ["//workspace/apps/a:app"] },
    ]);
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath,
      changedPaths: ["workspace/libs/core/src/index.ts"],
      projectPrefixes: ["workspace/apps", "workspace/libs"],
    });

    assert.equal(result.mode, "project-impact");
    assert.deepEqual(result.diagnostics.changedProjects, ["workspace/libs/core"]);
    assert.deepEqual(result.diagnostics.dependentProjects, [
      "workspace/apps/a",
      "workspace/apps/b",
    ]);
    assert.deepEqual(result.targets, [
      "//workspace/apps/a/...",
      "//workspace/apps/b/...",
      "//workspace/libs/core/...",
    ]);
  });
});

test("project-impact: mixed app/lib changes produce stable union without duplicates", async () => {
  await runInTemp("verify-project-impact-mixed-union", async (tmp, $) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//workspace/libs/core:lib", deps: [] },
      { name: "//workspace/apps/a:app", deps: ["//workspace/libs/core:lib"] },
      { name: "//workspace/apps/b:app", deps: ["//workspace/apps/a:app"] },
    ]);
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath,
      changedPaths: [
        "workspace/apps/b/src/main.ts",
        "workspace/libs/core/src/index.ts",
        "workspace/apps/b/src/main.ts",
      ],
      projectPrefixes: ["workspace/apps", "workspace/libs"],
    });

    assert.equal(result.mode, "project-impact");
    assert.deepEqual(result.targets, [
      "//workspace/apps/a/...",
      "//workspace/apps/b/...",
      "//workspace/libs/core/...",
    ]);
  });
});

test("project-impact: no project-owned changed paths keeps existing scope behavior", async () => {
  await runInTemp("verify-project-impact-no-project", async (tmp, $) => {
    const graphPath = await writeGraph(tmp, [{ name: "//workspace/apps/a:app", deps: [] }]);
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath,
      changedPaths: ["docs/guide.md"],
      projectPrefixes: ["workspace/apps", "workspace/libs"],
    });

    assert.equal(result.mode, "no-project-impact");
    assert.deepEqual(result.targets, []);
    assert.equal(result.diagnostics.reason, "no-project-owned-file-changes");
  });
});

test("project-impact: graph read failure falls back to existing broad scope", async () => {
  await runInTemp("verify-project-impact-fallback", async (tmp, $) => {
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath: path.join(tmp, "missing-graph.json"),
      changedPaths: ["workspace/apps/demo/src/main.ts"],
      projectPrefixes: ["workspace/apps", "workspace/libs"],
    });

    assert.equal(result.mode, "fallback-build-system-scope");
    assert.deepEqual(result.targets, []);
    assert.equal(result.diagnostics.reason, "graph-read-failed");
  });
});
