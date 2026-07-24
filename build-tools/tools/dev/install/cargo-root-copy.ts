import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ignoredCopyEntries = new Set([".git", ".viberoots", "buck-out", "node_modules", "target"]);

async function assertContainedSymlinks(root: string, dir = root): Promise<void> {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (ignoredCopyEntries.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await assertContainedSymlinks(root, file);
    if (!entry.isSymbolicLink()) continue;
    const target = await fsp.readlink(file);
    const resolved = path.resolve(path.dirname(file), target);
    if (
      path.isAbsolute(target) ||
      (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    ) {
      throw new Error(`Cargo temporary copy rejects external symlink: ${file} -> ${target}`);
    }
  }
}

export async function cargoLocks(root: string): Promise<string[]> {
  const locks: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (ignoredCopyEntries.has(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name === "Cargo.lock") locks.push(file);
    }
  }
  await visit(root);
  return locks.sort();
}

export async function copyCargoRoot(
  source: string,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  await assertContainedSymlinks(source);
  const owner = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-cargo-metadata-"));
  const root = path.join(owner, path.basename(source));
  await fsp.cp(source, root, {
    recursive: true,
    filter: (candidate) =>
      candidate === source || !ignoredCopyEntries.has(path.basename(candidate)),
  });
  return { root, cleanup: async () => await fsp.rm(owner, { recursive: true, force: true }) };
}
