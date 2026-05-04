#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runNixBuildWithTransientRetry } from "./build-selected-nix-retry";
import { getFlagBool, getFlagStr } from "../lib/cli";
import {
  computeSelectedCppPackageClosure,
  FILTERED_FLAKE_RSYNC_EXCLUDES,
  graphNodesFromJson,
  selectedCppSnapshotRsyncSources,
  selectedCppSnapshotRelPaths,
} from "./nix-build-filtered-flake-lib";

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
  const relPaths = selectedCppSnapshotRelPaths(packagePaths);
  const presentRelPaths: string[] = [];
  for (const relPath of relPaths) {
    const absPath = path.resolve(root, relPath);
    if (!(await pathExists(absPath))) continue;
    presentRelPaths.push(relPath);
  }
  const rsyncSources = selectedCppSnapshotRsyncSources(presentRelPaths);
  if (rsyncSources.length === 0) return null;
  return { packagePaths, rsyncSources };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(1);
  return `${mins}m${secs}s`;
}

function readInt(value: unknown): number {
  const n = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function readSnapshotStats(
  dir: string,
): Promise<{ fileCount: number; dirCount: number; kb: number }> {
  const [{ stdout: files }, { stdout: dirs }, { stdout: kb }] = await Promise.all([
    $({ stdio: "pipe" })`find ${dir} -type f | wc -l`,
    $({ stdio: "pipe" })`find ${dir} -type d | wc -l`,
    $({ stdio: "pipe" })`du -sk ${dir}`,
  ]);
  return {
    fileCount: readInt(files),
    dirCount: readInt(dirs),
    kb: readInt(String(kb || "").split(/\s+/)[0]),
  };
}

async function main(): Promise<void> {
  const attr = getFlagStr("attr", "");
  if (!attr) {
    console.error("[nix-build-filtered-flake] missing --attr");
    process.exit(2);
  }
  const snapshotOnly = getFlagBool("snapshot-only");
  const root = path.resolve(String(process.env.WORKSPACE_ROOT || process.cwd()).trim());
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDir = await fsp.mkdtemp(path.join(tmpBase, "bnx-flake-"));
  const snapDir = path.join(workDir, "src");
  let keepSnapshot = snapshotOnly;
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
    const snapshotStart = Date.now();
    if (selectedCppSources != null) {
      console.error(
        "[nix-build-filtered-flake] creating selected cpp snapshot:",
        snapDir,
        "packages=",
        selectedCppSources.packagePaths.join(","),
        "rsyncSources=",
        String(selectedCppSources.rsyncSources.length),
      );
      await withHeartbeat(
        "snapshot-rsync",
        $({
          stdio: "inherit",
          cwd: root,
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
    const snapshotStats = await readSnapshotStats(snapDir);
    console.error(
      `[nix-build-filtered-flake] snapshot ready in ${formatDuration(Date.now() - snapshotStart)} files=${snapshotStats.fileCount} dirs=${snapshotStats.dirCount} kb=${snapshotStats.kb}`,
    );
    if (snapshotOnly) {
      console.error(
        `[nix-build-filtered-flake] snapshot-only mode; keeping snapshot at ${snapDir}`,
      );
      process.stdout.write(`${snapDir}\n`);
      return;
    }
    const flakeRef = `path:${snapDir}#${attr}`;
    console.error("[nix-build-filtered-flake] building attr:", attr);
    const nixEnv =
      selectedCppSources != null
        ? {
            ...process.env,
            BNX_FILTERED_FLAKE_SNAPSHOT: "1",
            BUCK_GRAPH_JSON: path.join(snapDir, "build-tools", "tools", "buck", "graph.json"),
            BUCK_TEST_SRC: snapDir,
          }
        : {
            ...process.env,
            BNX_FILTERED_FLAKE_SNAPSHOT: "1",
          };
    const buildStart = Date.now();
    const runOnce = () =>
      withHeartbeat(
        "nix-build",
        $({
          stdio: "pipe",
          env: nixEnv,
          reject: false,
          nothrow: true,
        })`nix build --impure ${flakeRef} --accept-flake-config --option min-free 0 --option max-free 0 --no-link --print-out-paths`,
      );
    const res = await runNixBuildWithTransientRetry({ runOnce });
    if (Number(res.exitCode || 0) !== 0) {
      const err = new Error(`nix build exited with code ${res.exitCode}`);
      (err as Error & { stderr?: string }).stderr = String(res.stderr || "");
      process.stderr.write(String(res.stderr || ""));
      throw err;
    }
    const outPath =
      String(res.stdout || "")
        .trim()
        .split(/\n+/)
        .filter(Boolean)
        .at(-1) || "";
    console.error(
      `[nix-build-filtered-flake] nix build finished in ${formatDuration(Date.now() - buildStart)}${outPath ? ` out=${outPath}` : ""}`,
    );
    process.stdout.write(String(res.stdout || ""));
  } finally {
    if (!keepSnapshot) {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
