import path from "node:path";
import type { LangEntry } from "./types";
import { pathExists } from "./fs";

export async function detectEnabledAndMissing(
  langs: Map<string, LangEntry>,
  enabledPref: Set<string>,
  filterId: string,
): Promise<{
  enabled: string[];
  disabled: Array<{ id: string; missingPaths: string[] }>;
}> {
  const enabled: string[] = [];
  const disabled: Array<{ id: string; missingPaths: string[] }> = [];

  const prefer = (id: string) => (enabledPref.size === 0 ? true : enabledPref.has(id));
  const existsAbs = async (rel: string) => pathExists(path.resolve(rel));

  const ids = Array.from(langs.keys()).sort();
  for (const id of ids) {
    if (filterId && id !== filterId) continue;
    const e = langs.get(id) || { id };
    const req = Array.isArray(e.requiredPaths) ? e.requiredPaths : [];
    const missing: string[] = [];
    for (const r of req) {
      if (!(await existsAbs(r))) missing.push(r);
    }
    if (prefer(id) && missing.length === 0) enabled.push(id);
    else disabled.push({ id, missingPaths: missing });
  }

  return { enabled, disabled };
}
