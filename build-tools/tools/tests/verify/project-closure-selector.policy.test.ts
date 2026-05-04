#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { resolveProjectClosureSelection } from "../../lib/project-closure-selector";
import { runInTemp } from "../lib/test-helpers";

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
      { name: "//workspace/apps/puzzle:app", deps: ["//workspace/libs/ui:lib"] },
      { name: "//workspace/libs/ui:lib", deps: ["//workspace/libs/theme:lib"] },
      { name: "//workspace/libs/theme:lib", deps: [] },
    ]);
    const result = await resolveProjectClosureSelection({
      root: tmp,
      graphPath,
      requestedProjects: ["workspace/apps/puzzle"],
      projectPrefixes: ["workspace/apps", "workspace/libs"],
    });

    assert.equal(result.mode, "project-closure");
    assert.deepEqual(result.diagnostics.requestedProjects, ["workspace/apps/puzzle"]);
    assert.deepEqual(result.diagnostics.resolvedDependencyClosure, [
      "workspace/apps/puzzle",
      "workspace/libs/theme",
      "workspace/libs/ui",
    ]);
    assert.deepEqual(result.targets, [
      "//workspace/apps/puzzle/...",
      "//workspace/libs/theme/...",
      "//workspace/libs/ui/...",
    ]);
  });
});

test("project-closure: multiple requested projects merge closure without duplicate targets", async () => {
  await runInTemp("verify-project-closure-merged", async (tmp) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//workspace/apps/puzzle:app", deps: ["//workspace/libs/ui:lib"] },
      { name: "//workspace/apps/admin:app", deps: ["//workspace/libs/ui:lib"] },
      { name: "//workspace/libs/ui:lib", deps: ["//workspace/libs/theme:lib"] },
      { name: "//workspace/libs/theme:lib", deps: [] },
    ]);
    const result = await resolveProjectClosureSelection({
      root: tmp,
      graphPath,
      requestedProjects: ["workspace/apps/admin", "workspace/apps/puzzle", "workspace/apps/admin"],
      projectPrefixes: ["workspace/apps", "workspace/libs"],
    });

    assert.deepEqual(result.diagnostics.resolvedDependencyClosure, [
      "workspace/apps/admin",
      "workspace/apps/puzzle",
      "workspace/libs/theme",
      "workspace/libs/ui",
    ]);
    assert.deepEqual(result.targets, [
      "//workspace/apps/admin/...",
      "//workspace/apps/puzzle/...",
      "//workspace/libs/theme/...",
      "//workspace/libs/ui/...",
    ]);
  });
});

test("project-closure: invalid project id fails fast with canonical-path guidance", async () => {
  await runInTemp("verify-project-closure-invalid", async (tmp) => {
    const graphPath = await writeGraph(tmp, [
      { name: "//workspace/apps/puzzle:app", deps: [] },
      { name: "//workspace/libs/shared-ui:lib", deps: [] },
    ]);

    await assert.rejects(
      () =>
        resolveProjectClosureSelection({
          root: tmp,
          graphPath,
          requestedProjects: ["puzzle"],
          projectPrefixes: ["workspace/apps", "workspace/libs"],
        }),
      (error: unknown) => {
        const message = String((error as Error)?.message || error);
        assert.match(message, /canonical repo-relative project paths/);
        assert.match(message, /workspace\/apps\/puzzle/);
        return true;
      },
    );
  });
});

test("project-closure: large closure resolution remains bounded", async () => {
  await runInTemp("verify-project-closure-bounded", async (tmp) => {
    const nodes: GraphNode[] = [];
    for (let i = 0; i < 400; i++) {
      const current = `//workspace/libs/lib-${i}:lib`;
      const next = i + 1 < 400 ? [`//workspace/libs/lib-${i + 1}:lib`] : [];
      nodes.push({ name: current, deps: next });
    }
    nodes.push({
      name: "//workspace/apps/puzzle:app",
      deps: ["//workspace/libs/lib-0:lib"],
    });
    const graphPath = await writeGraph(tmp, nodes);

    const start = performance.now();
    const result = await resolveProjectClosureSelection({
      root: tmp,
      graphPath,
      requestedProjects: ["workspace/apps/puzzle"],
      projectPrefixes: ["workspace/apps", "workspace/libs"],
    });
    const elapsedMs = performance.now() - start;

    assert.equal(result.diagnostics.resolvedDependencyClosure.length, 401);
    assert.ok(elapsedMs < 1000, `expected closure resolution under 1000ms, got ${elapsedMs}`);
  });
});
