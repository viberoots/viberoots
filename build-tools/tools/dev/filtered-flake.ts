import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  filteredFlakeDiagnosticsEnabled,
  formatTimingDuration,
  readDirtyGitStats,
  readSnapshotStats,
} from "./filtered-flake-diagnostics";
import { filteredFlakeRsyncExcludeArgs } from "./nix-build-filtered-flake-lib";
import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";
import { emitTimingDetail } from "../lib/timing-detail";
import { resolveToolPathSync } from "../lib/tool-paths";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../lib/macos-metadata";

function executablePath(filePath: string): string {
  const candidate = filePath.trim();
  if (!candidate || !path.isAbsolute(candidate)) return "";
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return "";
  }
}

function resolveNixBin(): string {
  const fromEnv = executablePath(String(process.env.NIX_BIN || ""));
  if (fromEnv) return fromEnv;
  return resolveToolPathSync("nix");
}

export async function makeFilteredFlakeRef(opts: {
  workspaceRoot: string;
  attr: string;
  logPrefix: string;
  graphPath?: string;
}): Promise<{ flakeRef: string; workspaceRoot: string; cleanup: () => Promise<void> }> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDirRaw = await mkdtempNoindex("vbr-flake-", {
    baseName: "vbr-flake",
    tmpBase,
  });
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  const snapDir = path.join(workDir, "src");
  await mkdirWithMacosMetadataExclusion(snapDir);
  const snapDirReal = await fsp.realpath(snapDir).catch(() => snapDir);
  const src = path.resolve(opts.workspaceRoot);
  console.warn(
    `${opts.logPrefix} creating filtered source snapshot (excludes node_modules, buck-out, etc.)`,
  );
  if (filteredFlakeDiagnosticsEnabled()) {
    const dirty = await readDirtyGitStats(src);
    if (dirty) {
      const sample =
        dirty.sample.length > 0 ? ` sample=${dirty.sample.join(" | ").slice(0, 400)}` : "";
      console.warn(`${opts.logPrefix} dirty-tree entries=${dirty.entryCount}${sample}`);
    }
  }
  const snapshotStart = Date.now();
  const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
  await $({
    stdio: "pipe",
  })`rsync -a --delete ${rsyncExcludes} ${src}/ ${snapDirReal}/`;
  await copyWorkspaceGraphIntoSnapshot(src, snapDirReal, opts.graphPath);
  if (filteredFlakeDiagnosticsEnabled()) {
    const stats = await readSnapshotStats(snapDirReal);
    const elapsedMs = Date.now() - snapshotStart;
    emitTimingDetail("filteredFlake snapshotRsync", elapsedMs);
    console.warn(
      `${opts.logPrefix} snapshot ready in ${formatTimingDuration(elapsedMs)} files=${stats.fileCount} dirs=${stats.dirCount} kb=${stats.kb}`,
    );
  }
  const hiddenFlake = path.join(snapDirReal, ".viberoots", "workspace", "flake.nix");
  const rootFlake = path.join(snapDirReal, "flake.nix");
  const flakeDir = (await fsp
    .access(hiddenFlake)
    .then(() => true)
    .catch(() => false))
    ? path.dirname(hiddenFlake)
    : (await fsp
          .access(rootFlake)
          .then(() => true)
          .catch(() => false))
      ? snapDirReal
      : "";
  if (!flakeDir) {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(
      `${opts.logPrefix} filtered source snapshot is missing .viberoots/workspace/flake.nix and flake.nix`,
    );
  }
  await repairSnapshotViberootsInput({ snapDir: snapDirReal, flakeDir });
  return {
    flakeRef: `path:${flakeDir}#${opts.attr}`,
    workspaceRoot: snapDirReal,
    cleanup: async () => {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function copyWorkspaceGraphIntoSnapshot(
  root: string,
  snapDir: string,
  explicitGraphPath?: string,
): Promise<void> {
  const graphPath = path.resolve(
    String(explicitGraphPath || process.env.BUCK_GRAPH_JSON || path.join(root, DEFAULT_GRAPH_PATH)),
  );
  try {
    await fsp.access(graphPath);
  } catch {
    return;
  }
  const snapshotGraphPath = path.join(snapDir, DEFAULT_GRAPH_PATH);
  await mkdirWithMacosMetadataExclusion(path.dirname(snapshotGraphPath));
  await fsp.copyFile(graphPath, snapshotGraphPath);
}

async function repairSnapshotViberootsInput(opts: {
  snapDir: string;
  flakeDir: string;
}): Promise<void> {
  const snapshotViberootsRoot = path.join(opts.snapDir, "viberoots");
  try {
    await fsp.access(path.join(snapshotViberootsRoot, "flake.nix"));
  } catch {
    return;
  }
  const flakeLocalViberootsRoot = path.join(opts.flakeDir, "viberoots");
  const liveViberootsRoot = await tempRepoLiveViberootsRoot();
  if (liveViberootsRoot) {
    await fsp.rm(flakeLocalViberootsRoot, { recursive: true, force: true }).catch(() => {});
    await rewriteViberootsInput(opts.flakeDir, liveViberootsRoot);
    return;
  }
  await fsp.rm(flakeLocalViberootsRoot, { recursive: true, force: true }).catch(() => {});
  await $({
    stdio: "pipe",
  })`rsync -a --delete --exclude .git --exclude node_modules ${snapshotViberootsRoot}/ ${flakeLocalViberootsRoot}/`;
  await rewriteViberootsInput(opts.flakeDir, "./viberoots");
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
  try {
    await fsp.access(path.join(root, "flake.nix"));
    await fsp.access(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"));
  } catch {
    return "";
  }
  return await fsp.realpath(root).catch(() => root);
}

async function rewriteViberootsInput(flakeDir: string, inputPath: string): Promise<void> {
  const resolvedInputPath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(flakeDir, inputPath);
  const lockedInput = await lockPathInput(resolvedInputPath);
  const originalPath = path.isAbsolute(inputPath) ? resolvedInputPath : inputPath;
  const flakePath = path.join(flakeDir, "flake.nix");
  const text = await fsp.readFile(flakePath, "utf8").catch(() => "");
  const next = text.replace(
    /(\bviberoots\.url\s*=\s*)"[^"]*"/,
    (_match, prefix: string) => `${prefix}"path:${inputPath}"`,
  );
  if (next !== text) await fsp.writeFile(flakePath, next, "utf8");
  const lockPath = path.join(flakeDir, "flake.lock");
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
  const nixBin = resolveNixBin();
  const canonicalInputPath = await fsp.realpath(inputPath).catch(() => inputPath);
  const prefetched = await $({
    stdio: "pipe",
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
  })`${nixBin} hash path --sri ${canonicalInputPath}`;
  const narHash = String(hashed.stdout || "").trim();
  if (!/^sha256-[A-Za-z0-9+/=_-]+$/.test(narHash)) {
    throw new Error(`[filtered-flake] failed to lock path input ${canonicalInputPath}`);
  }
  return {
    narHash,
    path: canonicalInputPath,
    type: "path",
  };
}
