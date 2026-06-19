import * as fsp from "node:fs/promises";
import path from "node:path";
import type { LangEntry } from "./types";
import { pathExists, sourcePath } from "./fs";

export async function detectPlannerPlugins(
  manifestLangs: Map<string, LangEntry>,
  filterId: string,
): Promise<string[]> {
  const dir = await sourcePath("build-tools/tools/nix/planner");
  const present: string[] = [];

  if (await pathExists(dir)) {
    const files = await fsp.readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith(".nix")) continue;
      const id = f.replace(/\.nix$/i, "");
      if (filterId && id !== filterId) continue;
      present.push(id);
    }
  }

  const ids = new Set(present);
  for (const id of manifestLangs.keys()) {
    if (filterId && id !== filterId) continue;
    const p = path.join(dir, `${id}.nix`);
    if (await pathExists(p)) ids.add(id);
  }

  return Array.from(ids).sort();
}
