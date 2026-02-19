import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { ensureGraph } from "../buck/glue-run.ts";
import { runNixBuildWithProgress } from "./run-runnable-nix.ts";

function lastOutPath(stdout: string, err: string): string {
  const outPath =
    String(stdout || "")
      .trim()
      .split(/\n+/)
      .filter(Boolean)
      .pop() || "";
  if (!outPath) throw new Error(err);
  return outPath;
}

export async function buildRunnableManifest(workspaceRoot: string): Promise<string> {
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  process.env.BUCK_TEST_SRC = workspaceRoot;
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.BUCK_GRAPH_JSON = graphPath;
  await ensureGraph();
  const stdout = await runNixBuildWithProgress({
    workspaceRoot,
    label: "build runnable manifest",
    args: [
      "--impure",
      "--no-write-lock-file",
      "--option",
      "eval-cache",
      "false",
      ".#graph-generator",
      "--accept-flake-config",
      "--no-link",
      "--print-out-paths",
      "-L",
    ],
  });
  const outPath = lastOutPath(stdout, "graph-generator did not emit an output path");
  const linkDir = path.join(workspaceRoot, "buck-out", "tmp");
  const linkPath = path.join(linkDir, "runnable-manifest-current");
  await fsp.mkdir(linkDir, { recursive: true });
  try {
    await fsp.rm(linkPath, { recursive: true, force: true });
  } catch {}
  await fsp.symlink(outPath, linkPath);
  return path.join(linkPath, "manifest.json");
}

export async function buildSelectedOutPath(workspaceRoot: string, target: string): Promise<string> {
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  process.env.BUCK_TEST_SRC = workspaceRoot;
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.BUCK_GRAPH_JSON = graphPath;
  process.env.BUCK_TARGET = target;
  await ensureGraph();
  const stdout = await runNixBuildWithProgress({
    workspaceRoot,
    label: `build selected target ${target}`,
    args: [
      "--impure",
      "--no-write-lock-file",
      "--option",
      "eval-cache",
      "false",
      `${workspaceRoot}#graph-generator-selected`,
      "--accept-flake-config",
      "--no-link",
      "--print-out-paths",
      "-L",
    ],
  });
  return lastOutPath(stdout, `graph-generator-selected produced no out path for ${target}`);
}
