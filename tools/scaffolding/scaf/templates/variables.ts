import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs.ts";

export async function readCopierVariables(templateDir: string): Promise<string[]> {
  const cfgs = ["copier.yaml", "copier.yml", ".copier-answers.yml"];
  for (const c of cfgs) {
    const p = path.join(templateDir, c);
    if (await exists(p)) {
      const txt = await fsp.readFile(p, "utf8").catch(() => "");
      const vars: string[] = [];
      for (const m of txt.matchAll(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(?:"[^"]*"|\S*)\s*$/gm)) {
        const key = m[1];
        if (!key.startsWith("_")) {
          vars.push(key);
        }
      }
      return Array.from(new Set(vars));
    }
  }
  return [];
}
