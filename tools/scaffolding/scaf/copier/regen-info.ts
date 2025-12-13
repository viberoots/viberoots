import path from "node:path";

import * as fsp from "node:fs/promises";

export async function readRegenInfo(targetDir: string): Promise<{
  src?: string;
  data: Record<string, any>;
}> {
  const answersFile = path.join(targetDir, ".copier-answers.yml");
  const txt = await fsp.readFile(answersFile, "utf8").catch(() => "");
  const src = /^scaf_src_path:\s*(\S+)/m.exec(txt)?.[1]?.trim();
  const name = /^name:\s*(\S+)/m.exec(txt)?.[1]?.trim() || path.basename(targetDir);
  const language = /^language:\s*(\S+)/m.exec(txt)?.[1]?.trim() || undefined;
  const template = /^template:\s*(\S+)/m.exec(txt)?.[1]?.trim() || undefined;
  const data: Record<string, any> = { name };
  if (language) data.language = language;
  if (template) data.template = template;
  return { src, data };
}
