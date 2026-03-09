#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { resolveProjectClosureSelection } from "../../lib/project-closure-selector.ts";
import { runInTemp } from "../lib/test-helpers.ts";

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

test("project-closure: single requested project includes full recursive dependency closure", async () => {
  await runInTemp("verify-project-closure-single", async (tmp) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//projects/apps/tangram:app", deps: ["//projects/libs/ui:lib"] },
      { name: "//projects/libs/ui:lib", deps: ["//projects/libs/theme:lib"] },
      { name: "//projects/libs/theme:lib", deps: [] },
    ]);
    const result = await resolveProjectClosureSelection({
      root: tmp,
      graphPath,
      requestedProjects: ["projects/apps/tangram"],
    });

    assert.equal(result.mode, "project-closure");
    assert.deepEqual(result.diagnostics.requestedProjects, ["projects/apps/tangram"]);
    assert.deepEqual(result.diagnostics.resolvedDependencyClosure, [
      "projects/apps/tangram",
      "projects/libs/theme",
      "projects/libs/ui",
    ]);
    assert.deepEqual(result.targets, [
      "//projects/apps/tangram/...",
      "//projects/libs/theme/...",
      "//projects/libs/ui/...",
    ]);
  });
});

test("project-closure: multiple requested projects merge closure without duplicate targets", async () => {
  await runInTemp("verify-project-closure-merged", async (tmp) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//projects/apps/tangram:app", deps: ["//projects/libs/ui:lib"] },
      { name: "//projects/apps/admin:app", deps: ["//projects/libs/ui:lib"] },
      { name: "//projects/libs/ui:lib", deps: ["//projects/libs/theme:lib"] },
      { name: "//projects/libs/theme:lib", deps: [] },
    ]);
    const result = await resolveProjectClosureSelection({
      root: tmp,
      graphPath,
      requestedProjects: ["projects/apps/admin", "projects/apps/tangram", "projects/apps/admin"],
    });

    assert.deepEqual(result.diagnostics.resolvedDependencyClosure, [
      "projects/apps/admin",
      "projects/apps/tangram",
      "projects/libs/theme",
      "projects/libs/ui",
    ]);
    assert.deepEqual(result.targets, [
      "//projects/apps/admin/...",
      "//projects/apps/tangram/...",
      "//projects/libs/theme/...",
      "//projects/libs/ui/...",
    ]);
  });
});

test("project-closure: invalid project id fails fast with canonical-path guidance", async () => {
  await runInTemp("verify-project-closure-invalid", async (tmp) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//projects/apps/tangram:app", deps: [] },
      { name: "//projects/libs/shared-ui:lib", deps: [] },
    ]);

    await assert.rejects(
      () =>
        resolveProjectClosureSelection({
          root: tmp,
          graphPath,
          requestedProjects: ["tangram"],
        }),
      (error: unknown) => {
        const message = String((error as Error)?.message || error);
        assert.match(message, /canonical repo-relative project paths/);
        assert.match(message, /projects\/apps\/tangram/);
        return true;
      },
    );
  });
});

test("project-closure: large closure resolution remains bounded", async () => {
  await runInTemp("verify-project-closure-bounded", async (tmp) => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 400; i++) {
      const current = `//projects/libs/lib-${i}:lib`;
      const next = i + 1 < 400 ? [`//projects/libs/lib-${i + 1}:lib`] : [];
      nodes.push({ name: current, deps: next });
    }
    nodes.push({
      name: "//projects/apps/tangram:app",
      deps: ["//projects/libs/lib-0:lib"],
    });
    const graphPath = await writeGraph(tmp, nodes);

    const start = performance.now();
    const result = await resolveProjectClosureSelection({
      root: tmp,
      graphPath,
      requestedProjects: ["projects/apps/tangram"],
    });
    const elapsedMs = performance.now() - start;

    assert.equal(result.diagnostics.resolvedDependencyClosure.length, 401);
    assert.ok(elapsedMs < 1000, `expected closure resolution under 1000ms, got ${elapsedMs}`);
  });
});
