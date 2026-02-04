import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";

export async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if ([".git", "node_modules", "buck-out", ".direnv", ".gitignore", ".tmp"].includes(e.name)) {
        continue;
      }
      yield* walk(p);
    } else {
      yield p;
    }
  }
}
