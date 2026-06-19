#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

test("planner suppresses dev override log when PLANNER_NO_DEV_OVERRIDE_LOG is set", async () => {
  await runInTemp("planner-dev-overrides-suppressed", async (tmp, $) => {
    const graph = path.join(tmp, "graph.json");
    await fs.writeFile(graph, "[]\n", "utf8");
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        CI: "",
        NIX_GO_DEV_OVERRIDE_JSON: "{}",
        NIX_CPP_DEV_OVERRIDE_JSON: "{}",
        PLANNER_NO_DEV_OVERRIDE_LOG: "1",
        BUCK_GRAPH_JSON: graph,
      },
    })`nix build ${`path:${await workspaceFlakeRef(tmp)}#graph-generator`} --print-out-paths --impure --accept-flake-config --no-link`;
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
    if (log.includes("[planner] dev overrides present:")) {
      console.error("did not expect dev override presence line when suppressed; build.log:\n", log);
      process.exit(2);
    }
  });
});
