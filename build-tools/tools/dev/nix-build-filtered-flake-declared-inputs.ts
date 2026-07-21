import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  graphDeclaredActionInputPaths,
  graphDeclaredProviderEdges,
  graphNodesFromJson,
  linkedWorkspacePackageName,
} from "./nix-build-filtered-flake-graph";
import { parsePnpmLock } from "../lib/pnpm-lock";

async function pathExists(filePath: string): Promise<boolean> {
  return await fsp
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

export async function readDeclaredBuckActionInputs(
  manifestPath: string,
  workspaceRoot: string,
  actionStateRoot = "",
): Promise<ReadonlySet<string> | null> {
  if (!manifestPath) return null;
  const manifest = path.resolve(manifestPath);
  // Compare through realpath so that macOS symlink pairs like /tmp → /private/tmp
  // do not falsely trip the owned-action-output guard.
  const manifestReal = await fsp.realpath(manifest).catch(() => manifest);
  const workspaceReal = await fsp
    .realpath(path.resolve(workspaceRoot))
    .catch(() => path.resolve(workspaceRoot));
  const stateRootReal = actionStateRoot
    ? await fsp.realpath(path.resolve(actionStateRoot)).catch(() => "")
    : "";
  const allowedRoot = stateRootReal
    ? stateRootReal + path.sep
    : path.join(workspaceReal, "buck-out") + path.sep;
  const stateStat = actionStateRoot ? await fsp.lstat(actionStateRoot).catch(() => null) : null;
  const stat = await fsp.lstat(manifest).catch(() => null);
  if (
    !stat?.isFile() ||
    stat.isSymbolicLink() ||
    (actionStateRoot && (!stateStat?.isDirectory() || stateStat.isSymbolicLink())) ||
    !manifestReal.startsWith(allowedRoot)
  ) {
    throw new Error(
      `[nix-build-filtered-flake] Buck declared-input manifest is not an owned action output: ${manifest}`,
    );
  }
  const entries = (await fsp.readFile(manifest, "utf8"))
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (entries.length === 0 || entries.some((value) => !path.isAbsolute(value))) {
    throw new Error("[nix-build-filtered-flake] Buck declared-input manifest is empty or invalid");
  }
  return new Set(entries.map((value) => path.resolve(value)));
}

export async function assertDeclaredBuckActionInput(
  source: string,
  declaredActionInputs: ReadonlySet<string> | null,
  kind: "importer" | "provider",
): Promise<string> {
  const sourceReal = await fsp.realpath(source);
  if (!declaredActionInputs?.has(sourceReal)) {
    throw new Error(
      `[nix-build-filtered-flake] ${kind} input is not an owned declared Buck input: ${source}`,
    );
  }
  return sourceReal;
}

export async function materializeDeclaredImporterInputs(opts: {
  root: string;
  snapDir: string;
  graphPath: string;
  target: string;
  importer: string;
  declaredActionInputs: ReadonlySet<string> | null;
}): Promise<void> {
  const graph = graphNodesFromJson(JSON.parse(await fsp.readFile(opts.graphPath, "utf8")));
  const importerPrefix = `${opts.importer}/`;
  const importerInputs = new Set(graphDeclaredActionInputPaths(graph, opts.target));
  const pendingDirs = [opts.importer];
  while (pendingDirs.length > 0) {
    const relativeDir = pendingDirs.pop() || "";
    const entries = await fsp.readdir(path.join(opts.root, relativeDir), { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.posix.join(relativeDir, entry.name);
      if (entry.isDirectory()) pendingDirs.push(relative);
      else if (entry.isSymbolicLink()) importerInputs.add(relative);
    }
  }
  for (const relative of [...importerInputs].sort()) {
    if (!relative.startsWith(importerPrefix)) continue;
    const source = path.join(opts.root, relative);
    const destination = path.join(opts.snapDir, relative);
    const sourceStat = await fsp.lstat(source).catch(() => null);
    let copySource = source;
    if (sourceStat?.isSymbolicLink()) {
      if (!opts.declaredActionInputs) {
        throw new Error(
          `[nix-build-filtered-flake] importer symlink requires explicit Buck action-root provenance: ${source}`,
        );
      }
      const linkTarget = await fsp.readlink(source);
      copySource = path.resolve(path.dirname(source), linkTarget);
      const immediateTargetStat = await fsp.lstat(copySource).catch(() => null);
      // Directory-typed importer inputs (e.g. node_modules pre-materialized by pnpm)
      // are already covered by the default rsync snapshot and by pnpm-store fixed-output
      // realization. Follow chains through link targets so we skip real directories even
      // when Buck stages them via nested symlinks.
      const resolvedTargetStat = await fsp.stat(copySource).catch(() => null);
      if (resolvedTargetStat?.isDirectory()) continue;
      if (immediateTargetStat?.isDirectory()) continue;
      if (!immediateTargetStat?.isFile()) {
        throw new Error(
          `[nix-build-filtered-flake] declared importer action symlink does not point directly to a regular file: ${source}`,
        );
      }
    } else if (sourceStat?.isDirectory()) {
      continue;
    } else if (!sourceStat?.isFile()) {
      throw new Error(
        `[nix-build-filtered-flake] declared importer action input is not a regular file: ${source}`,
      );
    }
    await assertDeclaredBuckActionInput(copySource, opts.declaredActionInputs, "importer");
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.rm(destination, { force: true });
    await fsp.copyFile(copySource, destination);
  }
}

export async function materializeDeclaredProviderEdges(opts: {
  root: string;
  snapDir: string;
  graphPath: string;
  target: string;
  importer: string;
  declaredActionInputs: ReadonlySet<string> | null;
}): Promise<void> {
  if (!opts.target) return;
  const graph = graphNodesFromJson(JSON.parse(await fsp.readFile(opts.graphPath, "utf8")));
  const edges = graphDeclaredProviderEdges(graph, opts.target);
  const resolvedEdges: Array<{ edge: (typeof edges)[number]; source: string }> = [];
  for (const edge of edges) {
    const declaredInput = path.join(opts.root, edge.actionPath);
    const inputStat = await fsp.lstat(declaredInput).catch(() => null);
    let source = declaredInput;
    if (inputStat?.isSymbolicLink()) {
      if (!opts.declaredActionInputs) {
        throw new Error(
          `[nix-build-filtered-flake] provider symlink requires explicit Buck action-root provenance: ${declaredInput}`,
        );
      }
      const linkTarget = await fsp.readlink(declaredInput);
      source = path.resolve(path.dirname(declaredInput), linkTarget);
      const immediateTargetStat = await fsp.lstat(source).catch(() => null);
      if (!immediateTargetStat?.isFile()) {
        throw new Error(
          `[nix-build-filtered-flake] declared provider symlink does not point directly to a regular file: ${declaredInput}`,
        );
      }
    } else if (!inputStat?.isFile()) {
      throw new Error(
        `[nix-build-filtered-flake] declared provider input is not a regular file: ${declaredInput}`,
      );
    }
    await assertDeclaredBuckActionInput(source, opts.declaredActionInputs, "provider");
    resolvedEdges.push({ edge, source });
  }
  const edgesByPackage = new Map<string, typeof resolvedEdges>();
  for (const resolved of resolvedEdges) {
    const group = edgesByPackage.get(resolved.edge.packagePath) || [];
    group.push(resolved);
    edgesByPackage.set(resolved.edge.packagePath, group);
  }
  for (const [packagePath, packageEdges] of edgesByPackage) {
    if (!packagePath) continue;
    const packageManifest = path.join(opts.snapDir, packagePath, "package.json");
    const declaresManifest = packageEdges.some(
      ({ source }) => path.basename(source) === "package.json",
    );
    if (!(await pathExists(packageManifest)) && !declaresManifest && packageEdges.length !== 1) {
      throw new Error(
        `[nix-build-filtered-flake] provider package without a manifest must declare exactly one output: ${packagePath}`,
      );
    }
  }
  resolvedEdges.sort((left, right) =>
    path.basename(left.source) === "package.json"
      ? -1
      : path.basename(right.source) === "package.json"
        ? 1
        : left.edge.actionPath.localeCompare(right.edge.actionPath),
  );
  for (const { edge, source } of resolvedEdges) {
    // Non-root-cell provider edges (e.g. workspace_providers//:...) have no in-tree
    // linked workspace package. Mirror the Buck action layout so downstream Nix
    // evaluation sees the declared input at its expected __provider_edges__ path.
    const destination = edge.packagePath
      ? path.join(opts.snapDir, edge.packagePath, path.basename(source))
      : path.join(opts.snapDir, edge.actionPath);
    if (await pathExists(destination)) {
      throw new Error(
        `[nix-build-filtered-flake] declared provider output collides with snapshot source: ${destination}`,
      );
    }
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    if (!edge.packagePath) continue;
    const packageManifest = path.join(opts.snapDir, edge.packagePath, "package.json");
    if (!(await pathExists(packageManifest))) {
      const lock = await parsePnpmLock(path.join(opts.snapDir, opts.importer, "pnpm-lock.yaml"));
      const name = linkedWorkspacePackageName(lock, opts.importer, edge.packagePath);
      await fsp.writeFile(
        packageManifest,
        `${JSON.stringify({ name, private: true, exports: { ".": `./${path.basename(source)}` } }, null, 2)}\n`,
        { flag: "wx" },
      );
    }
  }
}
