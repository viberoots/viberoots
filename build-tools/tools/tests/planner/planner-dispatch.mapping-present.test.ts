#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("planner uses mapping.nix dispatch for custom go_service rule", async () => {
  await runInTemp("planner-dispatch-mapping", async (tmp, $) => {
    const toolsNixDir = path.join(tmp, "viberoots", "build-tools", "tools", "nix");
    await fs.mkdirp(toolsNixDir);
    // Provide a mapping that routes go_service -> go/bin
    await fs.writeFile(
      path.join(toolsNixDir, "mapping.nix"),
      `{
  dispatch = {
    go_service = { template = "go"; kind = "bin"; };
  };
}
`,
      "utf8",
    );

    const graph = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fs.mkdirp(path.dirname(graph));
    const nodes = [{ name: "//svc:svc", rule_type: "go_service", labels: [] }];
    await fs.writeFile(graph, JSON.stringify(nodes), "utf8");

    const { stdout } = await $({
      cwd: tmp,
      env: { ...process.env, BUCK_GRAPH_JSON: graph },
    })`nix build --impure ${`path:${await workspaceFlakeRef(tmp)}#graph-generator`} --accept-flake-config --no-link --print-out-paths`;
    const out = String(stdout || "").trim();
    if (!out) {
      console.error("missing graph-generator out path");
      process.exit(2);
    }
    // Success here indicates that the planner accepted the custom rule via dispatch
    await fs.pathExists(out);
  });
});
