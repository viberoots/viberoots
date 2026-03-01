#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { withScopedEnv } from "../lib/test-helpers/scoped-env.ts";
import { ensureGraph } from "../../buck/glue-run.ts";

test("ensureGraph is a no-op when BUCK_TARGET is already present in the graph", async () => {
  await runInTemp("ensure-graph-buck-target-present", async (tmp) => {
    const graphPath = path.join(tmp, "build-tools", "tools", "buck", "graph.json");
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
        await ensureGraph({
          exportGraph: async () => {
            invoked = true;
            await fsp.writeFile(graphPath, "[]\n", "utf8");
          },
        });

        const st2 = await fsp.stat(graphPath);
        if (invoked) {
          console.error("expected ensureGraph() to be a no-op (injected exporter was called)");
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
