#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";
import { withScopedEnv } from "../lib/test-helpers/scoped-env";
import { ensureGraph } from "../../buck/glue-run";

test("ensureGraph writes once; second call is a no-op", async () => {
  await runInTemp("ensure-graph-idempotent", async (tmp) => {
    const graph = path.join(tmp, DEFAULT_GRAPH_PATH);
    // Direct ensureGraph to operate on the temp workspace
    await withScopedEnv(
      {
        WORKSPACE_ROOT: tmp,
        // So exporter doesn't fail the run due to warn-level adapter findings in temp repos
        EXPORTER_VALIDATION: "warn",
        // Keep the query scope small in temp repos
        BUCK_QUERY_ROOTS: "libs,apps,cpp,go,third_party",
      },
      async () => {
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
      },
    );
  });
});
