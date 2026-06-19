#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("nix build --no-link does not create ./result symlink in temp repos", async () => {
  await runInTemp("nix-build-no-result-symlink", async (tmp, $) => {
    const graph = path.join(tmp, ".viberoots", "workspace", "buck", "graph.json");
    await fsp.mkdir(path.dirname(graph), { recursive: true });
    await fsp.writeFile(graph, "[]\n", "utf8");

    await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, BUCK_GRAPH_JSON: graph },
    })`nix build --impure ${`path:${await workspaceFlakeRef(tmp)}#graph-generator`} --accept-flake-config --no-link --print-out-paths`;

    try {
      await fsp.lstat(path.join(tmp, "result"));
      throw new Error(
        "unexpected ./result symlink created (expected --no-link to avoid out-links)",
      );
    } catch (e: any) {
      if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
        return;
      }
      throw e;
    }
  });
});
