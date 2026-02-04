import * as fsp from "node:fs/promises";
import path from "node:path";
import type { LangEntry } from "./types";
import { pathExists } from "./fs";

export async function detectPlannerPlugins(
  manifestLangs: Map<string, LangEntry>,
  filterId: string,
): Promise<string[]> {
  const dir = path.resolve("build-tools/tools/nix/planner");
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
    const p = path.resolve("build-tools/tools/nix/planner", `${id}.nix`);
    if (await pathExists(p)) ids.add(id);
  }

  return Array.from(ids).sort();
}
