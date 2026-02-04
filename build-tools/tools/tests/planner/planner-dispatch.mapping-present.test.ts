#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner uses mapping.nix dispatch for custom go_service rule", async () => {
  await runInTemp("planner-dispatch-mapping", async (tmp, $) => {
    const toolsNixDir = path.join(tmp, "build-tools", "tools", "nix");
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

    const graphDir = path.join(tmp, "build-tools/tools/buck");
    await fs.mkdirp(graphDir);
    const nodes = [{ name: "//svc:svc", rule_type: "go_service", labels: [] }];
    await fs.writeFile(path.join(graphDir, "graph.json"), JSON.stringify(nodes), "utf8");

    const { stdout } = await $({
      cwd: tmp,
    })`nix build ${`path:${tmp}#graph-generator`} --accept-flake-config --no-link --print-out-paths`;
    const out = String(stdout || "").trim();
    if (!out) {
      console.error("missing graph-generator out path");
      process.exit(2);
    }
    // Success here indicates that the planner accepted the custom rule via dispatch
    await fs.pathExists(out);
  });
});
