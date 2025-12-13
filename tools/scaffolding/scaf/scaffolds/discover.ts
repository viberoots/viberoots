import path from "node:path";

import * as fsp from "node:fs/promises";

import { walk } from "../walk.ts";

export type DiscoveredScaffold = {
  path: string;
  language: string;
  template: string;
  name: string;
  templateRef?: string;
};

export async function discoverScaffolds(root: string = "."): Promise<DiscoveredScaffold[]> {
  const out: DiscoveredScaffold[] = [];
  for await (const f of walk(root)) {
    if (path.basename(f) === ".copier-answers.yml") {
      const dir = path.dirname(f);
      const name = path.basename(dir);
      const txt = await fsp.readFile(f, "utf8").catch(() => "");
      const lang =
        /language:\s*(\S+)/m.exec(txt)?.[1] || (dir.includes("libs/") ? "go" : "unknown");
      const tmpl =
        /template:\s*(\S+)/m.exec(txt)?.[1] || (dir.includes("libs/") ? "lib" : "unknown");
      const templateRef = /^scaf_src_path:\s*(\S+)/m.exec(txt)?.[1]?.trim();
      out.push({ path: dir, language: lang, template: tmpl, name, templateRef });
    }
  }
  return out;
}
