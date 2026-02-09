#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

const TIMEOUT_SECS = Number(
  process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "1200",
);

test("planner logs dev override presence for C++ (non-CI)", async () => {
  await runInTemp("planner-dev-overrides-cpp", async (tmp, $) => {
    const graph = path.join(tmp, "graph.json");
    await fs.writeFile(graph, "[]\n", "utf8");
    const cmd = `set -euo pipefail; timeout ${TIMEOUT_SECS}s nix build ${`path:${tmp}#graph-generator`} --print-out-paths --impure --accept-flake-config --no-link`;
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        // Ensure non-CI and set only C++ overrides
        CI: "",
        NIX_CPP_DEV_OVERRIDE_JSON: "{}",
        BUCK_GRAPH_JSON: graph,
      },
    })`bash --noprofile --norc -c ${cmd}`;
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
    if (!log.includes("[planner] dev overrides present: cpp")) {
      console.error("expected '[planner] dev overrides present: cpp' in build.log, got:\n", log);
      process.exit(2);
    }
  });
});
