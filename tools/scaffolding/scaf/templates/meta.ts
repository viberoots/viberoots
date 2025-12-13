import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs.ts";
import { isLanguageEnabled } from "../language-enablement.ts";
import { readCopierVariables } from "./variables.ts";

export type TemplateMetaRow = {
  language: string;
  template: string;
  description: string;
  help: any;
  variables: string[];
};

export async function readTemplateMeta(language?: string): Promise<TemplateMetaRow[]> {
  const root = path.join("tools", "scaffolding", "templates");
  let langs = language ? [language] : (await exists(root)) ? await fsp.readdir(root) : [];

  const filtered: string[] = [];
  for (const l of langs) {
    if (await isLanguageEnabled(l)) filtered.push(l);
  }
  langs = filtered;

  const out: TemplateMetaRow[] = [];
  for (const l of langs) {
    const langDir = path.join(root, l);
    if (!(await exists(langDir))) {
      continue;
    }
    const entries = await fsp.readdir(langDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) {
        continue;
      }
      const tmpl = e.name;
      const tmplDir = path.join(langDir, tmpl);
      const metaPath = path.join(tmplDir, "meta.json");
      let meta: any = { language: l, template: tmpl };
      if (await exists(metaPath)) {
        try {
          meta = JSON.parse(await fsp.readFile(metaPath, "utf8"));
        } catch (err) {
          console.warn(`warning: failed to parse ${metaPath}:`, err);
        }
      } else {
        meta.description = `${l} ${tmpl}`;
      }
      const variables = await readCopierVariables(tmplDir).catch(() => [] as string[]);
      out.push({
        language: l,
        template: tmpl,
        description: meta.description || "",
        help: meta.help || {},
        variables,
      });
    }
  }
  return out;
}
