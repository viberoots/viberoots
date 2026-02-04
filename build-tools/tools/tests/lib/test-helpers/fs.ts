import * as fsp from "node:fs/promises";

export async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}
