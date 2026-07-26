#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import path from "node:path";

const [rootArg, manifestArg] = process.argv.slice(2);
if (!rootArg || !manifestArg) throw new Error("source snapshot root and manifest are required");

const root = fs.realpathSync(rootArg);
const manifestPath = fs.realpathSync(manifestArg);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schemaVersion !== "viberoots.source-snapshot.v1") {
  throw new Error(`unsupported source snapshot manifest schema: ${String(manifest.schemaVersion)}`);
}
if (manifest.graphPathInSnapshot !== ".viberoots/workspace/buck/graph.json") {
  throw new Error("source snapshot manifest does not declare the canonical graph path");
}
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error("source snapshot manifest has no declared files");
}
if (typeof manifest.declaredSnapshotRoot !== "string" || !manifest.declaredSnapshotRoot) {
  throw new Error("source snapshot manifest has no declared snapshot root");
}
if (fs.realpathSync(manifest.declaredSnapshotRoot) !== root) {
  throw new Error("source snapshot manifest root does not match the materialized snapshot");
}
const declaredFiles = [...manifest.files].sort();
function isWithinRoot(candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}
for (const relative of declaredFiles) {
  if (
    typeof relative !== "string" ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`source snapshot manifest contains an invalid path: ${String(relative)}`);
  }
  const candidate = path.resolve(root, relative);
  if (!isWithinRoot(candidate)) {
    throw new Error(`source snapshot manifest path escapes its root: ${relative}`);
  }
  const entry = fs.lstatSync(candidate);
  if (entry.isSymbolicLink()) {
    const target = fs.readlinkSync(candidate);
    if (path.isAbsolute(target)) {
      throw new Error(`source snapshot symlink target must be relative: ${relative} -> ${target}`);
    }
    const resolvedTarget = path.resolve(path.dirname(candidate), target);
    if (!isWithinRoot(resolvedTarget)) {
      throw new Error(`source snapshot symlink target escapes its root: ${relative} -> ${target}`);
    }
    const realTarget = fs.realpathSync(candidate);
    if (!isWithinRoot(realTarget)) {
      throw new Error(
        `source snapshot symlink resolves outside its root: ${relative} -> ${target}`,
      );
    }
  }
}
fs.accessSync(path.join(root, manifest.graphPathInSnapshot), fs.constants.R_OK);

const actualFiles: string[] = [];
function visit(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile() || entry.isSymbolicLink())
      actualFiles.push(path.relative(root, absolute));
  }
}
visit(root);
actualFiles.sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(declaredFiles)) {
  throw new Error("source snapshot files do not match the declared manifest inventory");
}
