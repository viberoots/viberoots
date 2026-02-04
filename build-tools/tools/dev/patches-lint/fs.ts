import * as fsp from "node:fs/promises";

export function isPatchFile(name: string): boolean {
  return name.endsWith(".patch");
}

export function isKeeperOrDotfile(name: string): boolean {
  return name.startsWith(".") || name === ".gitkeep" || name === ".keep";
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
