#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { reconcileGeneratedGraph } from "../../buck/glue-run";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";
import { withScopedEnv } from "../lib/test-helpers/scoped-env";

test("graph reconciliation bootstraps a missing declared graph source before export", async () => {
  await runInTemp("ensure-graph-bootstrap-source", async (tmp) => {
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);

    await withScopedEnv({ WORKSPACE_ROOT: tmp }, async () => {
      await reconcileGeneratedGraph({
        exportGraph: async () => {
          assert.equal(await fsp.readFile(graphPath, "utf8"), "[]\n");
          await fsp.writeFile(
            graphPath,
            JSON.stringify({ nodes: [{ name: "root//projects/apps/example:svc" }] }) + "\n",
            "utf8",
          );
        },
      });
    });

    assert.match(await fsp.readFile(graphPath, "utf8"), /projects\/apps\/example:svc/);
  });
});
