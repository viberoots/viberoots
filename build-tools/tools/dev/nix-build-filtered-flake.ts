#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runNixBuildWithTransientRetry } from "./build-selected-nix-retry";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { envWithResolvedNixBin, resolveToolPathSync } from "../lib/tool-paths";
import {
  computeSelectedCppPackageClosure,
  filteredFlakeRsyncExcludeArgs,
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  graphNodesFromJson,
  selectedCppSnapshotRsyncSources,
  selectedCppSnapshotRelPaths,
  selectedNodeSnapshotRelPaths,
  selectedNodeSnapshotRsyncSources,
  selectedPythonSnapshotRelPaths,
  selectedPythonSnapshotRsyncSources,
} from "./nix-build-filtered-flake-lib";
import { targetPackageFromLabel } from "./build-selected-helpers";
import { prepareExactPnpmStore } from "./update-pnpm-hash/exact-store";
import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";
import { getImporterRootsContract } from "../lib/importer-roots";
import { sanitizeName } from "../lib/sanitize";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../lib/macos-metadata";
import { findWorkspacePackageRepoDirs } from "./update-pnpm-hash/importer-workspace-packages";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function existingRelPaths(root: string, relPaths: readonly string[]): Promise<string[]> {
  const present: string[] = [];
  for (const relPath of relPaths) {
    if (await pathExists(path.join(root, relPath))) present.push(relPath);
  }
  return present;
}

async function resolveActiveViberootsRoot(root: string): Promise<string> {
  const candidates = [
    path.join(root, "viberoots"),
    path.join(root, ".viberoots", "current"),
    process.env.VIBEROOTS_SOURCE_ROOT || "",
    process.env.VIBEROOTS_ROOT || "",
    root,
  ]
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const abs = path.resolve(candidate);
    if (
      (await pathExists(path.join(abs, "flake.nix"))) &&
      (await pathExists(path.join(abs, "build-tools", "tools", "dev", "zx-init.mjs")))
    ) {
      return abs;
    }
  }
  return "";
}

async function repairSnapshotViberootsInput(snapDir: string): Promise<string> {
  const flakePath = await resolveSnapshotFlakePath(snapDir);
  const snapshotViberootsRoot = path.join(snapDir, "viberoots");
  if (!(await pathExists(path.join(snapshotViberootsRoot, "flake.nix")))) return "";
  const flakeDir = path.dirname(flakePath);
  const flakeLocalViberootsRoot = path.join(flakeDir, "viberoots");
  const liveViberootsRoot = await tempRepoLiveViberootsRoot();
  if (liveViberootsRoot) {
    await fsp.rm(flakeLocalViberootsRoot, { recursive: true, force: true }).catch(() => {});
    await rewriteSnapshotViberootsInput(flakePath, liveViberootsRoot);
    return liveViberootsRoot;
  }
  await fsp.rm(flakeLocalViberootsRoot, { recursive: true, force: true }).catch(() => {});
  await $({
    stdio: "pipe",
  })`rsync -a --delete --exclude .git --exclude node_modules ${snapshotViberootsRoot}/ ${flakeLocalViberootsRoot}/`;
  const nixRelViberootsRoot = "./viberoots";
  await rewriteSnapshotViberootsInput(flakePath, nixRelViberootsRoot);
  return nixRelViberootsRoot;
}

async function tempRepoLiveViberootsRoot(): Promise<string> {
  const raw = String(
    process.env.VIBEROOTS_FLAKE_INPUT_ROOT ||
      process.env.VIBEROOTS_SOURCE_ROOT ||
      process.env.VIBEROOTS_ROOT ||
      "",
  ).trim();
  if (!raw) return "";
  const root = path.resolve(raw);
  if (
    !(await pathExists(path.join(root, "flake.nix"))) ||
    !(await pathExists(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs")))
  ) {
    return "";
  }
  return await fsp.realpath(root).catch(() => root);
}

async function rewriteSnapshotViberootsInput(
  flakePath: string,
  viberootsInputPath: string,
): Promise<void> {
  const flakeDir = path.dirname(flakePath);
  const resolvedInputPath = path.isAbsolute(viberootsInputPath)
    ? viberootsInputPath
    : path.resolve(flakeDir, viberootsInputPath);
  const lockedInput = await lockPathInput(resolvedInputPath);
  const originalPath = path.isAbsolute(viberootsInputPath) ? resolvedInputPath : viberootsInputPath;
  const text = await fsp.readFile(flakePath, "utf8").catch(() => "");
  const next = text.replace(
    /(\bviberoots\.url\s*=\s*)"[^"]*"/,
    (_match, prefix: string) => `${prefix}"path:${viberootsInputPath}"`,
  );
  if (next !== text) {
    await fsp.writeFile(flakePath, next, "utf8");
  }
  const lockPath = path.join(path.dirname(flakePath), "flake.lock");
  try {
    const lock = JSON.parse(await fsp.readFile(lockPath, "utf8")) as {
      nodes?: Record<string, Record<string, unknown>>;
    };
    const node = lock.nodes?.viberoots;
    if (node) {
      node.locked = lockedInput;
      node.original = { type: "path", path: originalPath };
      await fsp.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    }
  } catch {}
}

async function lockPathInput(inputPath: string): Promise<Record<string, unknown>> {
  const nixEnv = envWithResolvedNixBin(process.env);
  const nixBin = resolveToolPathSync("nix", nixEnv);
  const canonicalInputPath = await fsp.realpath(inputPath).catch(() => inputPath);
  const prefetched = await $({
    stdio: "pipe",
    env: nixEnv,
  })`${nixBin} flake prefetch --json ${`path:${canonicalInputPath}`}`.nothrow();
  if (prefetched.exitCode === 0) {
    try {
      const parsed = JSON.parse(String(prefetched.stdout || "{}"));
      const locked = parsed?.locked || {};
      const narHash = typeof locked.narHash === "string" ? locked.narHash : "";
      if (/^sha256-[A-Za-z0-9+/=_-]+$/.test(narHash)) {
        return {
          ...(typeof locked.lastModified === "number" ? { lastModified: locked.lastModified } : {}),
          narHash,
          path: canonicalInputPath,
          type: "path",
        };
      }
    } catch {}
  }
  const hashed = await $({
    stdio: "pipe",
    env: nixEnv,
  })`${nixBin} hash path --sri ${canonicalInputPath}`;
  const narHash = String(hashed.stdout || "").trim();
  if (!/^sha256-[A-Za-z0-9+/=_-]+$/.test(narHash)) {
    throw new Error(`[nix-build-filtered-flake] failed to lock path input ${canonicalInputPath}`);
  }
  return {
    narHash,
    path: canonicalInputPath,
    type: "path",
  };
}

async function resolveSnapshotFlakePath(snapDir: string): Promise<string> {
  const hiddenFlake = path.join(snapDir, ".viberoots", "workspace", "flake.nix");
  if (await pathExists(hiddenFlake)) return hiddenFlake;
  return path.join(snapDir, "flake.nix");
}

async function resolveSnapshotFlakeDir(snapDir: string): Promise<string> {
  const flakePath = await resolveSnapshotFlakePath(snapDir);
  if (!(await pathExists(flakePath))) {
    throw new Error(
      `[nix-build-filtered-flake] snapshot is missing .viberoots/workspace/flake.nix and flake.nix: ${snapDir}`,
    );
  }
  return path.dirname(flakePath);
}

async function copyWorkspaceGraphIntoSnapshot(root: string, snapDir: string): Promise<void> {
  const graphPath = path.resolve(
    String(process.env.BUCK_GRAPH_JSON || path.join(root, DEFAULT_GRAPH_PATH)),
  );
  if (!(await pathExists(graphPath))) return;
  const snapshotGraphPath = path.join(snapDir, DEFAULT_GRAPH_PATH);
  const snapshotBuckRoot = path.join(snapDir, ".viberoots", "buck");
  await mkdirWithMacosMetadataExclusion(snapshotBuckRoot);
  await fsp.copyFile(graphPath, path.join(snapshotBuckRoot, "graph.json"));
  const snapshotWorkspaceBuck = path.dirname(snapshotGraphPath);
  const workspaceBuckStat = await fsp.lstat(snapshotWorkspaceBuck).catch(() => null);
  if (!workspaceBuckStat?.isSymbolicLink()) {
    await mkdirWithMacosMetadataExclusion(snapshotWorkspaceBuck);
    await fsp.copyFile(graphPath, snapshotGraphPath);
  }
}

async function readSelectedCppSnapshotSources(
  root: string,
): Promise<{ packagePaths: string[]; rsyncSources: string[] } | null> {
  const target = String(process.env.BUCK_TARGET || "").trim();
  const onlyCpp = String(process.env.PLANNER_ONLY_CPP || "").trim() !== "";
  if (!onlyCpp || !target) return null;
  const graphPath = path.resolve(
    String(process.env.BUCK_GRAPH_JSON || path.join(root, DEFAULT_GRAPH_PATH)),
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

async function readSelectedNodeSnapshotSources(
  root: string,
  attr: string,
): Promise<{ importer: string; rsyncSources: string[] } | null> {
  const nodeArtifactPrefixes = [
    "node-cli.",
    "node-service.",
    "node-test.",
    "node-vercel-next.",
    "node-webapp.",
  ];
  if (!nodeArtifactPrefixes.some((prefix) => attr.startsWith(prefix))) return null;
  const importers = await pnpmImportersFromAttrs(root, attr);
  const importer = targetPackageFromLabel(String(process.env.BUCK_TARGET || "")) || importers[0];
  if (!importer || importer === ".") return null;
  if (!(await pathExists(path.join(root, importer, "pnpm-lock.yaml")))) return null;
  const workspacePackageDirs = await findWorkspacePackageRepoDirs({
    repoRoot: root,
    importerAbs: path.join(root, importer),
  });
  const relPaths = selectedNodeSnapshotRelPaths(importer, workspacePackageDirs);
  const presentRelPaths: string[] = [];
  for (const relPath of relPaths) {
    const absPath = path.resolve(root, relPath);
    if (!(await pathExists(absPath))) continue;
    presentRelPaths.push(relPath);
  }
  const rsyncSources = selectedNodeSnapshotRsyncSources(presentRelPaths);
  if (rsyncSources.length === 0) return null;
  return { importer, rsyncSources };
}

async function readSelectedPythonSnapshotSources(
  root: string,
): Promise<{ importer: string; rsyncSources: string[] } | null> {
  const importer = targetPackageFromLabel(String(process.env.BUCK_TARGET || ""));
  if (!importer || importer === ".") return null;
  if (!(await pathExists(path.join(root, importer, "uv.lock")))) return null;
  const presentRelPaths = await existingRelPaths(root, selectedPythonSnapshotRelPaths(importer));
  const rsyncSources = selectedPythonSnapshotRsyncSources(presentRelPaths);
  if (rsyncSources.length === 0) return null;
  return { importer, rsyncSources };
}

async function readDefaultSnapshotSources(root: string): Promise<string[]> {
  const presentRelPaths = await existingRelPaths(root, defaultFilteredFlakeSnapshotRelPaths());
  return defaultFilteredFlakeSnapshotRsyncSources(presentRelPaths);
}

async function pnpmImportersFromAttrs(root: string, attr: string): Promise<string[]> {
  const { workspaceRoots } = getImporterRootsContract();
  const out: string[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const absRoot = path.join(root, workspaceRoot);
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(absRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const importer = path.posix.join(workspaceRoot, entry.name);
      if (sanitizeName(importer) !== attr.split(".").at(-1)) continue;
      if (!(await pathExists(path.join(root, importer, "pnpm-lock.yaml")))) continue;
      out.push(importer);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function exactStoreEnvForTarget(root: string, attr: string): Promise<Record<string, string>> {
  const targetImporter = targetPackageFromLabel(String(process.env.BUCK_TARGET || ""));
  const attrImporters = await pnpmImportersFromAttrs(root, attr);
  const importer = targetImporter || attrImporters[0] || "";
  if (!importer || !(await pathExists(path.join(root, importer, "pnpm-lock.yaml")))) return {};
  const prepared = await prepareExactPnpmStore({ repoRoot: root, importer });
  return { NIX_PNPM_EXACT_STORE: prepared.exactStorePath };
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
  const workDir = await mkdtempNoindex("vbr-flake-", {
    baseName: "vbr-flake",
    tmpBase,
  });
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
    await mkdirWithMacosMetadataExclusion(snapDir);
    const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
    const selectedCppSources = await readSelectedCppSnapshotSources(root);
    const selectedNodeSources =
      selectedCppSources == null ? await readSelectedNodeSnapshotSources(root, attr) : null;
    const selectedPythonSources =
      selectedCppSources == null && selectedNodeSources == null
        ? await readSelectedPythonSnapshotSources(root)
        : null;
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
    } else if (selectedNodeSources != null) {
      console.error(
        "[nix-build-filtered-flake] creating selected node snapshot:",
        snapDir,
        "importer=",
        selectedNodeSources.importer,
        "rsyncSources=",
        String(selectedNodeSources.rsyncSources.length),
      );
      await withHeartbeat(
        "snapshot-rsync",
        $({
          stdio: "inherit",
          cwd: root,
        })`rsync -a --delete --relative ${rsyncExcludes} ${selectedNodeSources.rsyncSources} ${snapDir}/`,
      );
    } else if (selectedPythonSources != null) {
      console.error(
        "[nix-build-filtered-flake] creating selected python snapshot:",
        snapDir,
        "importer=",
        selectedPythonSources.importer,
        "rsyncSources=",
        String(selectedPythonSources.rsyncSources.length),
      );
      await withHeartbeat(
        "snapshot-rsync",
        $({
          stdio: "inherit",
          cwd: root,
        })`rsync -a --delete --relative ${rsyncExcludes} ${selectedPythonSources.rsyncSources} ${snapDir}/`,
      );
    } else {
      console.error("[nix-build-filtered-flake] creating filtered snapshot:", snapDir);
      const defaultSources = await readDefaultSnapshotSources(root);
      await withHeartbeat(
        "snapshot-rsync",
        $({
          stdio: "inherit",
          cwd: root,
        })`rsync -a --delete --relative ${rsyncExcludes} ${defaultSources} ${snapDir}/`,
      );
    }
    await copyWorkspaceGraphIntoSnapshot(root, snapDir);
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
    const flakeDir = await resolveSnapshotFlakeDir(snapDir);
    const flakeRef = `path:${flakeDir}#${attr}`;
    console.error("[nix-build-filtered-flake] building attr:", attr);
    const activeViberootsRoot = await resolveActiveViberootsRoot(root);
    const snapshotViberootsInput = await repairSnapshotViberootsInput(snapDir);
    if (snapshotViberootsInput) {
      console.error(
        "[nix-build-filtered-flake] repaired snapshot viberoots input:",
        snapshotViberootsInput,
      );
    }
    const nixEnv = envWithResolvedNixBin({
      ...process.env,
      ...(await exactStoreEnvForTarget(root, attr)),
      WORKSPACE_ROOT: snapDir,
      ...(activeViberootsRoot ? { VIBEROOTS_SOURCE_ROOT: activeViberootsRoot } : {}),
      VBR_FILTERED_FLAKE_SNAPSHOT: "1",
      ...(selectedCppSources != null
        ? {
            BUCK_GRAPH_JSON: path.join(snapDir, DEFAULT_GRAPH_PATH),
            BUCK_TEST_SRC: snapDir,
          }
        : {}),
    });
    const nixBin = resolveToolPathSync("nix", nixEnv);
    const buildStart = Date.now();
    const nixArgs = [
      "build",
      "--impure",
      "--accept-flake-config",
      flakeRef,
      "--option",
      "min-free",
      "0",
      "--option",
      "max-free",
      "0",
      "--no-link",
      "--print-out-paths",
    ];
    const runOnce = () =>
      withHeartbeat(
        "nix-build",
        $({
          stdio: "pipe",
          env: nixEnv,
          reject: false,
          nothrow: true,
        })`${nixBin} ${nixArgs}`,
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
    if (!outPath) {
      throw new Error("[nix-build-filtered-flake] nix build produced no output path");
    }
    process.stdout.write(`${outPath}\n`);
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
