#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { ensureGraph } from "../../buck/glue-run.ts";

test("ensureGraph writes once; second call is a no-op", async () => {
  await runInTemp("ensure-graph-idempotent", async (tmp) => {
    const graph = path.join(tmp, "tools/buck", "graph.json");
    // Direct ensureGraph to operate on the temp workspace
    const prev = process.env.WORKSPACE_ROOT;
    const prevVal = process.env.EXPORTER_VALIDATION;
    const prevRoots = process.env.BUCK_QUERY_ROOTS;
    process.env.WORKSPACE_ROOT = tmp;
    // So exporter doesn't fail the run due to warn-level adapter findings in temp repos
    process.env.EXPORTER_VALIDATION = "warn";
    // Keep the query scope small in temp repos
    process.env.BUCK_QUERY_ROOTS = "libs,apps,cpp,go,third_party";
    try {
      await ensureGraph();
      const st1 = await fsp.stat(graph);
      // Ensure timestamp granularity can't mask a rewrite
      await new Promise((r) => setTimeout(r, 1100));
      await ensureGraph();
      const st2 = await fsp.stat(graph);
      if (st1.mtimeMs !== st2.mtimeMs) {
        console.error("expected second ensureGraph() to be a no-op (mtime changed)", {
          first: st1.mtimeMs,
          second: st2.mtimeMs,
        });
        process.exit(2);
      }
    } finally {
      if (prev === undefined) delete process.env.WORKSPACE_ROOT;
      else process.env.WORKSPACE_ROOT = prev;
      if (prevVal === undefined) delete process.env.EXPORTER_VALIDATION;
      else process.env.EXPORTER_VALIDATION = prevVal;
      if (prevRoots === undefined) delete process.env.BUCK_QUERY_ROOTS;
      else process.env.BUCK_QUERY_ROOTS = prevRoots;
    }
  });
});
