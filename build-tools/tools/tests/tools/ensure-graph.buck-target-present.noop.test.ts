#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { withScopedEnv } from "../lib/test-helpers/scoped-env";
import { reconcileGeneratedGraph } from "../../buck/glue-run";
import { DEFAULT_GRAPH_PATH } from "../../lib/workspace-state-paths";

test("graph reconciliation is a no-op when BUCK_TARGET is already present", async () => {
  await runInTemp("ensure-graph-buck-target-present", async (tmp) => {
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });

    await withScopedEnv(
      { WORKSPACE_ROOT: tmp, BUCK_TARGET: "//projects/apps/example:svc" },
      async () => {
        await fsp.writeFile(
          graphPath,
          JSON.stringify(
            {
              $schema: "x",
              version: 1,
              nodes: [{ name: `root${process.env.BUCK_TARGET} (config//test)` }],
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

        const st1 = await fsp.stat(graphPath);
        await new Promise((r) => setTimeout(r, 1100));

        let invoked = false;
        await reconcileGeneratedGraph({
          exportGraph: async () => {
            invoked = true;
            await fsp.writeFile(graphPath, "[]\n", "utf8");
          },
        });

        const st2 = await fsp.stat(graphPath);
        if (invoked) {
          console.error("expected graph reconciliation to skip the exporter");
          process.exit(2);
        }
        if (st1.mtimeMs !== st2.mtimeMs) {
          console.error("expected graph.json mtime to be stable when target is present", {
            first: st1.mtimeMs,
            second: st2.mtimeMs,
          });
          process.exit(2);
        }
      },
    );
  });
});

test("graph reconciliation hides debug lines unless VBR_VERBOSE is enabled", async () => {
  await runInTemp("ensure-graph-quiet-debug", async (tmp) => {
    const graphPath = path.join(tmp, DEFAULT_GRAPH_PATH);
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });
    await fsp.writeFile(
      graphPath,
      JSON.stringify({
        $schema: "x",
        version: 1,
        nodes: [{ name: "root//projects/apps/example:svc (config//test)" }],
      }) + "\n",
      "utf8",
    );

    const capture = async (verbose: string | undefined): Promise<string[]> => {
      const lines: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      };
      try {
        await withScopedEnv(
          {
            VBR_VERBOSE: verbose,
            WORKSPACE_ROOT: tmp,
            BUCK_TARGET: "//projects/apps/example:svc",
          },
          async () => {
            await reconcileGeneratedGraph();
          },
        );
      } finally {
        console.error = original;
      }
      return lines;
    };

    assert.deepEqual(await capture(undefined), []);
    assert.ok((await capture("1")).some((line) => line.includes("[ensureGraph] workspaceRoot=")));
  });
});
