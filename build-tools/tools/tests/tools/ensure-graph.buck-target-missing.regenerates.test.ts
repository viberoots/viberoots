#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { withScopedEnv } from "../lib/test-helpers/scoped-env";
import { ensureGraph } from "../../buck/glue-run";

test("ensureGraph regenerates when BUCK_TARGET is missing from the existing graph", async () => {
  await runInTemp("ensure-graph-buck-target-missing", async (tmp) => {
    const graphPath = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graphPath), { recursive: true });

    await withScopedEnv(
      { WORKSPACE_ROOT: tmp, BUCK_TARGET: "//projects/apps/example:svc" },
      async () => {
        await fsp.writeFile(
          graphPath,
          JSON.stringify({ $schema: "x", version: 1, nodes: [] }, null, 2) + "\n",
          "utf8",
        );

        let invoked = false;
        await ensureGraph({
          exportGraph: async () => {
            invoked = true;
            const want = String(process.env.BUCK_TARGET || "").trim();
            await fsp.writeFile(
              graphPath,
              JSON.stringify(
                { $schema: "x", version: 1, nodes: [{ name: `root${want} (config//test)` }] },
                null,
                2,
              ) + "\n",
              "utf8",
            );
          },
        });

        if (!invoked) {
          console.error("expected ensureGraph() to regenerate via injected exporter");
          process.exit(2);
        }

        const txt = await fsp.readFile(graphPath, "utf8");
        if (!txt.includes(String(process.env.BUCK_TARGET))) {
          console.error("expected regenerated graph.json to contain BUCK_TARGET", {
            target: process.env.BUCK_TARGET,
          });
          process.exit(2);
        }
      },
    );
  });
});
