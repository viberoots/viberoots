#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("nix builds graph-generator", async () => {
  await runInTemp("nix-build-graph-generator", async (tmp, $) => {
    const graph = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fs.mkdirp(path.dirname(graph));
    await fs.writeFile(graph, "[]\n", "utf8");
    const { stdout } = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, BUCK_GRAPH_JSON: graph },
    })`nix build --impure ${`path:${await workspaceFlakeRef(tmp)}#graph-generator`} --accept-flake-config --no-link --print-out-paths`;
    if (!String(stdout || "").trim()) {
      console.error("graph-generator produced no out path");
      process.exit(2);
    }
  });
});
