import * as fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export function toFileUrl(p: string): string {
  return pathToFileURL(path.resolve(p)).toString();
}

export async function sourceRoot(cwd = process.cwd()): Promise<string> {
  if (await pathExists(path.join(cwd, "viberoots", "build-tools"))) {
    return path.join(cwd, "viberoots");
  }
  if (await pathExists(path.join(cwd, "build-tools", "tools", "dev", "zx-init.mjs"))) {
    return cwd;
  }
  const envRoot = String(
    process.env.VIBEROOTS_SOURCE_ROOT || process.env.VIBEROOTS_ROOT || "",
  ).trim();
  if (envRoot) return path.resolve(envRoot);
  return cwd;
}

export async function sourcePath(relPath: string, cwd = process.cwd()): Promise<string> {
  return path.join(await sourceRoot(cwd), relPath);
}
