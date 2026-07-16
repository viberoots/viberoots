import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";

export type BundleFile = {
  path: string;
  type: "file" | "symlink";
  mode: number;
  sha256?: string;
  target?: string;
};

const dependencyNames = new Set([
  "flake.lock",
  "go.mod",
  "go.sum",
  "gomod2nix.toml",
  "langs.json",
  "node-modules.hashes.json",
  "pnpm-lock.yaml",
  "uv.lock",
]);

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bundleRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function assertInternalSymlink(root: string, file: string, target: string): void {
  if (path.isAbsolute(target)) throw new Error(`evaluation bundle external symlink: ${file}`);
  const resolved = path.resolve(path.dirname(file), target);
  const relative = path.relative(root, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`evaluation bundle external symlink: ${file}`);
  }
}

export async function inventoryBundleSource(root: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = bundleRelative(root, absolute);
      const stat = await fsp.lstat(absolute);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        files.push({
          path: relative,
          type: "file",
          mode: stat.mode & 0o777,
          sha256: sha256(await fsp.readFile(absolute)),
        });
      } else if (entry.isSymbolicLink()) {
        const target = await fsp.readlink(absolute);
        assertInternalSymlink(root, absolute, target);
        files.push({ path: relative, type: "symlink", mode: stat.mode & 0o777, target });
      } else {
        throw new Error(`evaluation bundle unsupported entry: ${relative}`);
      }
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function dependencyInputs(files: readonly BundleFile[]) {
  return files.filter((file) => {
    const base = path.posix.basename(file.path);
    return dependencyNames.has(base) || file.path.includes("/providers/");
  });
}

export function manifestDigest(value: unknown): string {
  return sha256(`${JSON.stringify(value)}\n`);
}
