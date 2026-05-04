import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs";

export async function recordSource(dest: string, language: string, template: string) {
  const answers = path.join(dest, ".copier-answers.yml");
  const relSrc = path.join("build-tools", "tools", "scaffolding", "templates", language, template);
  const line = `scaf_src_path: ${relSrc}`;
  const existsAns = await exists(answers);
  if (!existsAns) {
    const name = path.basename(dest);
    const base = `name: ${name}\nlanguage: ${language}\ntemplate: ${template}\n${line}\n`;
    await fsp.writeFile(answers, base, "utf8");
    return;
  }
  let cur = await fsp.readFile(answers, "utf8").catch(() => "");
  const ensureLine = (key: string, value: string) => {
    if (new RegExp(`^${key}:\\s`, "m").test(cur)) {
      cur = cur.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
    } else {
      cur += (cur.endsWith("\n") ? "" : "\n") + `${key}: ${value}\n`;
    }
  };
  ensureLine("name", path.basename(dest));
  ensureLine("language", language);
  ensureLine("template", template);
  if (!cur.includes("scaf_src_path:")) {
    cur += (cur.endsWith("\n") ? "" : "\n") + line + "\n";
  }
  await fsp.writeFile(answers, cur, "utf8");
}
