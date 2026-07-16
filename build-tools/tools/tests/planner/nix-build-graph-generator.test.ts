#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("nix builds graph-generator", async () => {
  await runInTemp("nix-build-graph-generator", async (tmp, $) => {
    const stableRoot = path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "viberoots-nix-build-graph-generator.noindex",
    );
    await fs.remove(stableRoot);
    await fs.symlink(tmp, stableRoot, "dir");
    try {
      const buckRoot = path.join(tmp, ".viberoots", "workspace", "buck");
      const rootEnv = path.join(buckRoot, "workspace-root.env");
      const normalizedEnv = (await fs.readFile(rootEnv, "utf8")).replaceAll(tmp, stableRoot);
      await fs.writeFile(rootEnv, normalizedEnv, "utf8");
      const graph = path.join(stableRoot, ".viberoots", "workspace", "buck", "graph.json");
      await fs.writeFile(graph, "[]\n", "utf8");
      const { stdout } = await $({
        cwd: stableRoot,
        stdio: "pipe",
        env: {
          ...process.env,
          BUCK_GRAPH_JSON: graph,
          BUCK_TEST_SRC: stableRoot,
          WORKSPACE_ROOT: stableRoot,
        },
      })`nix build --impure ${`path:${await workspaceFlakeRef(stableRoot)}#graph-generator`} --accept-flake-config --no-link --print-out-paths`;
      if (!String(stdout || "").trim()) {
        console.error("graph-generator produced no out path");
        process.exit(2);
      }
    } finally {
      await fs.remove(stableRoot);
    }
  });
});
