#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli.ts";
import {
  computeSelectedCppPackageClosure,
  FILTERED_FLAKE_RSYNC_EXCLUDES,
  graphNodesFromJson,
  selectedCppSnapshotRelPaths,
} from "./nix-build-filtered-flake-lib.ts";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readSelectedCppSnapshotSources(
  root: string,
): Promise<{ packagePaths: string[]; rsyncSources: string[] } | null> {
  const target = String(process.env.BUCK_TARGET || "").trim();
  const onlyCpp = String(process.env.PLANNER_ONLY_CPP || "").trim() !== "";
  if (!onlyCpp || !target) return null;
  const graphPath = path.resolve(
    String(
      process.env.BUCK_GRAPH_JSON || path.join(root, "build-tools", "tools", "buck", "graph.json"),
    ),
  );
  if (!(await pathExists(graphPath))) return null;
  let rawGraph: unknown;
  try {
    rawGraph = JSON.parse(await fsp.readFile(graphPath, "utf8"));
  } catch {
    return null;
  }
  const packagePaths = computeSelectedCppPackageClosure(graphNodesFromJson(rawGraph), target);
  if (packagePaths.length === 0) return null;
  const rsyncSources: string[] = [];
  for (const relPath of selectedCppSnapshotRelPaths(packagePaths)) {
    const absPath = path.resolve(root, relPath);
    if (!(await pathExists(absPath))) continue;
    rsyncSources.push(`${root}/./${relPath}`);
  }
  if (rsyncSources.length === 0) return null;
  return { packagePaths, rsyncSources };
}

async function main(): Promise<void> {
  const attr = getFlagStr("attr", "");
  if (!attr) {
    console.error("[nix-build-filtered-flake] missing --attr");
    process.exit(2);
  }
  const root = path.resolve(String(process.env.WORKSPACE_ROOT || process.cwd()).trim());
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDir = await fsp.mkdtemp(path.join(tmpBase, "bnx-flake-"));
  const snapDir = path.join(workDir, "src");
  const withHeartbeat = async <T>(label: string, p: Promise<T>): Promise<T> => {
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      console.error(`[nix-build-filtered-flake] ${label} still running (${elapsed}s)`);
    }, 15000);
    try {
      return await p;
    } finally {
      clearInterval(timer);
    }
  };
  try {
    await fsp.mkdir(snapDir, { recursive: true });
    const rsyncExcludes = FILTERED_FLAKE_RSYNC_EXCLUDES.map((entry) => ["--exclude", entry]).flat();
    const selectedCppSources = await readSelectedCppSnapshotSources(root);
    if (selectedCppSources != null) {
      console.error(
        "[nix-build-filtered-flake] creating selected cpp snapshot:",
        snapDir,
        "packages=",
        selectedCppSources.packagePaths.join(","),
      );
      await withHeartbeat(
        "snapshot-rsync",
        $({
          stdio: "inherit",
        })`rsync -a --delete --relative ${rsyncExcludes} ${selectedCppSources.rsyncSources} ${snapDir}/`,
      );
    } else {
      console.error("[nix-build-filtered-flake] creating filtered snapshot:", snapDir);
      await withHeartbeat(
        "snapshot-rsync",
        $({
          stdio: "inherit",
        })`rsync -a --delete ${rsyncExcludes} ${root}/ ${snapDir}/`,
      );
    }
    const flakeRef = `path:${snapDir}#${attr}`;
    console.error("[nix-build-filtered-flake] building attr:", attr);
    const nixEnv =
      selectedCppSources != null
        ? {
            ...process.env,
            BUCK_GRAPH_JSON: path.join(snapDir, "build-tools", "tools", "buck", "graph.json"),
            BUCK_TEST_SRC: snapDir,
          }
        : process.env;
    const res = await withHeartbeat(
      "nix-build",
      $({
        stdio: "pipe",
        env: nixEnv,
      })`nix build --impure ${flakeRef} --accept-flake-config --option min-free 0 --option max-free 0 --no-link --print-out-paths`,
    );
    process.stdout.write(String(res.stdout || ""));
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
