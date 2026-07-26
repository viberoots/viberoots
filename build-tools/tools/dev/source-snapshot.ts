#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { sourcePlanEvidenceFromGraphFile } from "./source-snapshot-graph";
import {
  forbiddenSnapshotPath,
  GRAPH_PATH_IN_SNAPSHOT,
  SOURCE_SNAPSHOT_EXCLUDES,
} from "./source-snapshot-policy";
import { rustCompositionEvidence } from "./rust-composition-evidence";

type FileArg = { rel: string; src: string };

function argvTokens(): string[] {
  const raw = Array.isArray(process.argv) ? process.argv : [];
  const scriptIdx = raw.findIndex((token, index) => index > 0 && /\.(ts|js|mjs|cjs)$/.test(token));
  return (scriptIdx >= 0 ? raw.slice(scriptIdx + 1) : raw.slice(2)).filter(
    (token) => typeof token === "string",
  );
}

function argValue(tokens: string[], name: string): string {
  const eq = tokens.find((token) => token.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = tokens.indexOf(`--${name}`);
  return i >= 0 ? String(tokens[i + 1] || "") : "";
}

function fileArgs(tokens: string[]): FileArg[] {
  const out: FileArg[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "--file") continue;
    const rel = String(tokens[i + 1] || "").replace(/^\/+/, "");
    const src = String(tokens[i + 2] || "");
    if (rel && src) out.push({ rel, src });
    i += 2;
  }
  return out;
}

function matchingFileArgs(tokens: string[]): FileArg[] {
  const out: FileArg[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "--require-matching-file") continue;
    const rel = String(tokens[i + 1] || "").replace(/^\/+/, "");
    const src = String(tokens[i + 2] || "");
    if (rel && src) out.push({ rel, src });
    i += 2;
  }
  return out;
}

function treeArgs(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "--tree") continue;
    const tree = String(tokens[i + 1] || "");
    if (tree) out.push(tree);
    i += 1;
  }
  return out;
}

async function copyFile(src: string, dest: string): Promise<void> {
  const stat = await fsp.lstat(src);
  if (!stat.isFile() && !stat.isSymbolicLink()) return;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  if (stat.isSymbolicLink()) {
    const target = await fsp.readlink(src);
    await fsp.symlink(target, dest).catch(async () => {
      await fsp.rm(dest, { force: true });
      await fsp.symlink(target, dest);
    });
  } else {
    await fsp.copyFile(src, dest);
  }
}

async function matchingFile(left: string, right: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([fsp.lstat(left), fsp.lstat(right)]);
  if (leftStat.isSymbolicLink() !== rightStat.isSymbolicLink()) return false;
  if (leftStat.isSymbolicLink()) {
    const [leftTarget, rightTarget] = await Promise.all([fsp.readlink(left), fsp.readlink(right)]);
    return leftTarget === rightTarget;
  }
  if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false;
  const [leftBytes, rightBytes] = await Promise.all([fsp.readFile(left), fsp.readFile(right)]);
  return leftBytes.equals(rightBytes);
}

async function walk(dir: string, base: string, files: FileArg[]): Promise<void> {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    if (forbiddenSnapshotPath(rel)) continue;
    if (entry.isDirectory()) await walk(abs, base, files);
    else if (entry.isFile() || entry.isSymbolicLink()) files.push({ rel, src: abs });
  }
}

async function manifestFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) await visit(abs);
      else if (entry.isFile() || entry.isSymbolicLink()) out.push(rel);
    }
  }
  await visit(root);
  return out.sort();
}

async function main(): Promise<void> {
  const tokens = argvTokens();
  const out = path.resolve(argValue(tokens, "out"));
  const manifest = path.resolve(argValue(tokens, "manifest"));
  const graph = argValue(tokens, "graph");
  const workspaceRoot = path.resolve(argValue(tokens, "workspace-root") || process.cwd());
  const declaredRoot = argValue(tokens, "declared-root") || out;
  const declaredGraph = argValue(tokens, "declared-graph") || graph;
  if (!out || !manifest) throw new Error("--out and --manifest are required");
  const treeFiles: FileArg[] = [];
  for (const tree of treeArgs(tokens)) await walk(tree, tree, treeFiles);
  const overlays = fileArgs(tokens);
  if (treeFiles.length === 0 && overlays.length === 0) {
    await walk(workspaceRoot, workspaceRoot, treeFiles);
  }
  const baseFiles = new Map<string, string>();
  for (const file of treeFiles) baseFiles.set(file.rel.replace(/^\/+/, ""), file.src);
  for (const required of matchingFileArgs(tokens)) {
    const baseSource = baseFiles.get(required.rel);
    if (!baseSource) {
      throw new Error(`declared snapshot is missing required owner source: ${required.rel}`);
    }
    if (!(await matchingFile(baseSource, required.src))) {
      throw new Error(`declared snapshot has stale owner source: ${required.rel}`);
    }
  }
  const files = [...treeFiles, ...overlays];
  if (graph) files.push({ rel: GRAPH_PATH_IN_SNAPSHOT, src: graph });
  await fsp.rm(out, { recursive: true, force: true });
  await fsp.mkdir(out, { recursive: true });
  const copied: string[] = [];
  const selected = new Map<string, string>();
  for (const file of files) {
    const rel = file.rel.replace(/^\/+/, "");
    if (!rel || forbiddenSnapshotPath(rel)) continue;
    if (!fs.existsSync(file.src)) continue;
    selected.set(rel, file.src);
  }
  for (const [rel, src] of [...selected.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    await copyFile(src, path.join(out, rel));
    copied.push(rel);
  }
  const snapshotFiles = await manifestFiles(out);
  const rustComposition = await rustCompositionEvidence(tokens);
  const data = {
    schemaVersion: "viberoots.source-snapshot.v1",
    declaredSnapshotRoot: declaredRoot,
    ambientWorkspaceRoot: workspaceRoot,
    declaredGraphPath: declaredGraph,
    graphPathInSnapshot: GRAPH_PATH_IN_SNAPSHOT,
    sourcePlans: await sourcePlanEvidenceFromGraphFile(graph),
    excludes: SOURCE_SNAPSHOT_EXCLUDES,
    files: snapshotFiles,
    copiedFiles: [...new Set(copied)].sort(),
    ...(rustComposition ? { rustComposition } : {}),
  };
  await fsp.mkdir(path.dirname(manifest), { recursive: true });
  await fsp.writeFile(manifest, JSON.stringify(data, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
