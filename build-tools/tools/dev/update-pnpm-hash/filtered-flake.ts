import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  filteredFlakeDiagnosticsEnabled,
  formatTimingDuration,
  readDirtyGitStats,
  readSnapshotStats,
} from "../filtered-flake-diagnostics";
import {
  defaultFilteredFlakeSnapshotRelPaths,
  defaultFilteredFlakeSnapshotRsyncSources,
  filteredFlakeRsyncExcludeArgs,
  selectedNodeSnapshotRelPaths,
  selectedNodeSnapshotRsyncSources,
} from "../nix-build-filtered-flake-lib";
import { emitTimingDetail } from "../../lib/timing-detail";
import { resolveToolPathSync } from "../../lib/tool-paths";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../../lib/macos-metadata";
import { findWorkspacePackageRepoDirs } from "./importer-workspace-packages";

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

async function existingRelPaths(root: string, relPaths: readonly string[]): Promise<string[]> {
  const present: string[] = [];
  for (const rel of relPaths) {
    try {
      await fsp.lstat(path.join(root, rel));
      present.push(rel);
    } catch {}
  }
  return present;
}

export async function makeFilteredFlakeRef(opts: {
  repoRoot: string;
  attr: string;
  importer?: string;
}): Promise<{ flakeRef: string; workspaceRoot: string; cleanup: () => Promise<void> }> {
  const tmpBase = process.env.TMPDIR || "/tmp";
  const workDirRaw = await mkdtempNoindex("scaf-flake-", {
    baseName: "scaf-flake",
    tmpBase,
  });
  const workDir = await fsp.realpath(workDirRaw).catch(() => workDirRaw);
  const snapDir = path.join(workDir, "src");
  await mkdirWithMacosMetadataExclusion(snapDir);
  const snapDirReal = await fsp.realpath(snapDir).catch(() => snapDir);
  const src = path.resolve(opts.repoRoot);
  if (filteredFlakeDiagnosticsEnabled()) {
    const dirty = await readDirtyGitStats(src);
    if (dirty) {
      const sample =
        dirty.sample.length > 0 ? ` sample=${dirty.sample.join(" | ").slice(0, 400)}` : "";
      console.warn(
        `[update-pnpm-hash] filtered flake dirty-tree entries=${dirty.entryCount}${sample}`,
      );
    }
  }
  const snapshotStart = Date.now();
  const rsyncExcludes = filteredFlakeRsyncExcludeArgs();
  const workspacePackageDirs = opts.importer
    ? await findWorkspacePackageRepoDirs({
        repoRoot: src,
        importerAbs: path.join(src, opts.importer),
      })
    : [];
  const requestedRelPaths = opts.importer
    ? selectedNodeSnapshotRelPaths(opts.importer, workspacePackageDirs)
    : defaultFilteredFlakeSnapshotRelPaths();
  const snapshotSources = opts.importer
    ? selectedNodeSnapshotRsyncSources(await existingRelPaths(src, requestedRelPaths))
    : defaultFilteredFlakeSnapshotRsyncSources(await existingRelPaths(src, requestedRelPaths));
  await $({
    stdio: "pipe",
    cwd: src,
  })`rsync -a --delete --relative ${rsyncExcludes} ${snapshotSources} ${snapDirReal}/`;
  if (filteredFlakeDiagnosticsEnabled()) {
    const stats = await readSnapshotStats(snapDirReal);
    const elapsedMs = Date.now() - snapshotStart;
    emitTimingDetail("filteredFlake updatePnpmHashSnapshotRsync", elapsedMs);
    console.warn(
      `[update-pnpm-hash] filtered flake snapshot ready in ${formatTimingDuration(elapsedMs)} files=${stats.fileCount} dirs=${stats.dirCount} kb=${stats.kb}`,
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
      "[update-pnpm-hash] filtered flake snapshot is missing .viberoots/workspace/flake.nix and flake.nix",
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
  await fsp.rm(flakeLocalViberootsRoot, { recursive: true, force: true }).catch(() => {});
  await $({
    stdio: "pipe",
  })`rsync -a --delete --exclude .git --exclude node_modules ${snapshotViberootsRoot}/ ${flakeLocalViberootsRoot}/`;
  await rewriteViberootsInput(opts.flakeDir, "./viberoots");
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
    throw new Error(`[update-pnpm-hash] failed to lock path input ${canonicalInputPath}`);
  }
  return {
    narHash,
    path: canonicalInputPath,
    type: "path",
  };
}
