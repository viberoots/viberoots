#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getArgvTokens } from "../lib/cli.ts";
import { findRepoRoot } from "../lib/repo.ts";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { ensureGraph } from "../buck/glue-run.ts";
import { runNixBuildWithProgress } from "./run-runnable-nix.ts";

async function main() {
  const args = getArgvTokens();
  const target = String(args[0] || "").trim();
  if (!target || target.startsWith("-")) {
    console.error("usage: probe-graph-generator-selected <target>");
    process.exit(2);
  }
  const root = await findRepoRoot(process.cwd());
  const graphPath = path.join(root, DEFAULT_GRAPH_PATH);
  process.env.BUCK_TEST_SRC = root;
  process.env.WORKSPACE_ROOT = root;
  process.env.BUCK_GRAPH_JSON = graphPath;
  process.env.BUCK_TARGET = target;
  if (!String(process.env.BNX_RUNNABLE_BUILD_TIMEOUT_SEC || "").trim()) {
    process.env.BNX_RUNNABLE_BUILD_TIMEOUT_SEC = "25";
  }
  await ensureGraph();
  const stdout = await runNixBuildWithProgress({
    workspaceRoot: root,
    env: process.env as Record<string, string>,
    label: `probe selected target ${target}`,
    args: [
      "--impure",
      "--no-write-lock-file",
      "--option",
      "eval-cache",
      "false",
      `${root}#graph-generator-selected`,
      "--accept-flake-config",
      "--no-link",
      "--print-out-paths",
      "-L",
    ],
  });
  const outPath =
    String(stdout || "")
      .trim()
      .split(/\n+/)
      .filter(Boolean)
      .pop() || "";
  if (!outPath) {
    throw new Error("probe: graph-generator-selected produced no out path");
  }
  console.log(outPath);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
