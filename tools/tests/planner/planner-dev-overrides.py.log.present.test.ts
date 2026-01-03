#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("planner logs dev override presence for Python (non-CI)", async () => {
  await runInTemp("planner-dev-overrides-py", async (tmp, $) => {
    const graph = path.join(tmp, "graph.json");
    await fs.writeFile(graph, "[]\n", "utf8");
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        // Ensure non-CI and set only Python overrides
        CI: "",
        NIX_PY_DEV_OVERRIDE_JSON: "{}",
        BUCK_GRAPH_JSON: graph,
      },
    })`nix build ${`path:${tmp}#graph-generator`} --print-out-paths --impure --accept-flake-config`;
    const outPath =
      String(res.stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
    if (!outPath) {
      console.error("graph-generator produced no out path");
      process.exit(2);
    }
    const logPath = path.join(outPath, "build.log");
    const log = await fs.readFile(logPath, "utf8").catch(() => "");
    if (!log.includes("[planner] dev overrides present: py")) {
      console.error("expected '[planner] dev overrides present: py' in build.log, got:\n", log);
      process.exit(2);
    }
  });
});
