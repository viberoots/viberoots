#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

function readLastOutPath(stdout: unknown): string {
  return String(stdout || "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() as string;
}

test("planner detects overrides via manifest mapping and respects PLANNER_NO_DEV_OVERRIDE_LOG", async () => {
  await runInTemp("planner-dev-overrides-manifest-mapping", async (tmp, $) => {
    const graph = path.join(tmp, "graph.json");
    await fs.writeFile(graph, "[]\n", "utf8");

    const manifestPath = path.join(tmp, "tools", "lib", "dev-override-envs.json");
    const manifest = (await fs.readJSON(manifestPath)) as Record<string, string>;
    const envName = String(manifest.python || "").trim();
    if (!envName) {
      console.error("manifest missing python override env name:", manifest);
      process.exit(2);
    }

    const res1 = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        CI: "",
        BUCK_GRAPH_JSON: graph,
        [envName]: "{}",
      },
    })`nix build ${`path:${tmp}#graph-generator`} --print-out-paths --impure --accept-flake-config --no-link`;
    const out1 = readLastOutPath(res1.stdout);
    const log1 = await fs.readFile(path.join(out1, "build.log"), "utf8").catch(() => "");
    if (!log1.includes("[planner] dev overrides present: py")) {
      console.error("expected python override presence line in build.log, got:\n", log1);
      process.exit(2);
    }

    const res2 = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        CI: "",
        BUCK_GRAPH_JSON: graph,
        [envName]: "{}",
        PLANNER_NO_DEV_OVERRIDE_LOG: "1",
      },
    })`nix build ${`path:${tmp}#graph-generator`} --print-out-paths --impure --accept-flake-config --no-link`;
    const out2 = readLastOutPath(res2.stdout);
    const log2 = await fs.readFile(path.join(out2, "build.log"), "utf8").catch(() => "");
    if (log2.includes("[planner] dev overrides present:")) {
      console.error(
        "did not expect dev override presence line when suppressed; build.log:\n",
        log2,
      );
      process.exit(2);
    }
  });
});
