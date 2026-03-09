#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers.ts";
import { resolveProjectImpactSelection } from "../../lib/project-impact-selector.ts";

type GraphNode = {
  name: string;
  deps: string[];
};

async function writeGraph(tmp: string, nodes: GraphNode[]): Promise<string> {
  const graphPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
  await fsp.mkdir(path.dirname(graphPath), { recursive: true });
  await fsp.writeFile(graphPath, JSON.stringify({ version: 1, nodes }, null, 2), "utf8");
  return graphPath;
}

test("project-impact: changed app selects only that app when no dependent projects exist", async () => {
  await runInTemp("verify-project-impact-single-app", async (tmp, $) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//projects/apps/demo:app", deps: [] },
      { name: "//projects/libs/shared:lib", deps: [] },
    ]);
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath,
      changedPaths: ["projects/apps/demo/src/main.ts"],
    });

    assert.equal(result.mode, "project-impact");
    assert.deepEqual(result.diagnostics.changedProjects, ["projects/apps/demo"]);
    assert.deepEqual(result.diagnostics.dependentProjects, []);
    assert.deepEqual(result.targets, ["//projects/apps/demo/..."]);
  });
});

test("project-impact: changed lib includes full recursive downstream dependent closure", async () => {
  await runInTemp("verify-project-impact-lib-closure", async (tmp, $) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//projects/libs/core:lib", deps: [] },
      { name: "//projects/apps/a:app", deps: ["//projects/libs/core:lib"] },
      { name: "//projects/apps/b:app", deps: ["//projects/apps/a:app"] },
    ]);
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath,
      changedPaths: ["projects/libs/core/src/index.ts"],
    });

    assert.equal(result.mode, "project-impact");
    assert.deepEqual(result.diagnostics.changedProjects, ["projects/libs/core"]);
    assert.deepEqual(result.diagnostics.dependentProjects, ["projects/apps/a", "projects/apps/b"]);
    assert.deepEqual(result.targets, [
      "//projects/apps/a/...",
      "//projects/apps/b/...",
      "//projects/libs/core/...",
    ]);
  });
});

test("project-impact: mixed app/lib changes produce stable union without duplicates", async () => {
  await runInTemp("verify-project-impact-mixed-union", async (tmp, $) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//projects/libs/core:lib", deps: [] },
      { name: "//projects/apps/a:app", deps: ["//projects/libs/core:lib"] },
      { name: "//projects/apps/b:app", deps: ["//projects/apps/a:app"] },
    ]);
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath,
      changedPaths: [
        "projects/apps/b/src/main.ts",
        "projects/libs/core/src/index.ts",
        "projects/apps/b/src/main.ts",
      ],
    });

    assert.equal(result.mode, "project-impact");
    assert.deepEqual(result.targets, [
      "//projects/apps/a/...",
      "//projects/apps/b/...",
      "//projects/libs/core/...",
    ]);
  });
});

test("project-impact: no project-owned changed paths keeps existing scope behavior", async () => {
  await runInTemp("verify-project-impact-no-project", async (tmp, $) => {
    const graphPath = await writeGraph(tmp, [{ name: "//projects/apps/a:app", deps: [] }]);
    const result = await resolveProjectImpactSelection({
      root: tmp,
      graphPath,
      changedPaths: ["docs/tangram-design.md"],
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
      changedPaths: ["projects/apps/demo/src/main.ts"],
    });

    assert.equal(result.mode, "fallback-build-system-scope");
    assert.deepEqual(result.targets, []);
    assert.equal(result.diagnostics.reason, "graph-read-failed");
  });
});
