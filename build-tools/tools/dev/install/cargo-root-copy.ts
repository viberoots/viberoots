import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reachableCargoRoots } from "./cargo-path-closure";

const ignoredCopyEntries = new Set([".git", ".viberoots", "buck-out", "node_modules", "target"]);

async function isNestedCargoRoot(owner: string, candidate: string): Promise<boolean> {
  if (candidate === owner) return false;
  return await fsp.access(path.join(candidate, "Cargo.toml")).then(
    () => true,
    () => false,
  );
}

async function copyOwnedCargoRoot(
  owner: string,
  source: string,
  destination: string,
): Promise<void> {
  await fsp.mkdir(destination, { recursive: true });
  for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
    if (ignoredCopyEntries.has(entry.name)) continue;
    const input = path.join(source, entry.name);
    const output = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      if (!(await isNestedCargoRoot(owner, input))) {
        await copyOwnedCargoRoot(owner, input, output);
      }
      continue;
    }
    if (entry.isSymbolicLink()) {
      const target = await fsp.readlink(input);
      const resolved = path.resolve(path.dirname(input), target);
      if (
        path.isAbsolute(target) ||
        (resolved !== owner && !resolved.startsWith(`${owner}${path.sep}`))
      ) {
        throw new Error(`Cargo temporary copy rejects external symlink: ${input} -> ${target}`);
      }
      await fsp.symlink(target, output);
      continue;
    }
    if (entry.isFile()) await fsp.copyFile(input, output);
  }
}

export async function cargoLocks(root: string): Promise<string[]> {
  const locks: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (ignoredCopyEntries.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory() && !(await isNestedCargoRoot(root, file))) await visit(file);
      else if (entry.isFile() && entry.name === "Cargo.lock") locks.push(file);
    }
  }
  await visit(root);
  return locks.sort();
}

export async function copyCargoRoot(
  source: string,
  workspaceRoot = source,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const workspace = path.resolve(workspaceRoot);
  const resolvedSource = path.resolve(source);
  if (resolvedSource !== workspace && !resolvedSource.startsWith(`${workspace}${path.sep}`)) {
    throw new Error(`Cargo root is outside the workspace: ${source}`);
  }
  const owner = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cargo-metadata-"));
  const snapshot = path.join(owner, "workspace");
  const roots = await reachableCargoRoots(resolvedSource, workspace);
  for (const cargoRoot of roots) {
    const destination = path.join(snapshot, path.relative(workspace, cargoRoot));
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await copyOwnedCargoRoot(cargoRoot, cargoRoot, destination);
  }
  const root = path.join(snapshot, path.relative(workspace, resolvedSource));
  return { root, cleanup: async () => await fsp.rm(owner, { recursive: true, force: true }) };
}
