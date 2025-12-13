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
