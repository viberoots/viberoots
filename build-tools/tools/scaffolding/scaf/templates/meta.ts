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
  const root = path.join("build-tools", "tools", "scaffolding", "templates");
  const requestedLanguage = language ? String(language).trim() : "";
  let langs = requestedLanguage
    ? [requestedLanguage]
    : (await exists(root))
      ? await fsp.readdir(root)
      : [];

  const filtered: string[] = [];
  for (const l of langs) {
    if (await isLanguageEnabled(l)) filtered.push(l);
  }
  langs = filtered;

  const out: TemplateMetaRow[] = [];
  for (const l of langs) {
    const langDir = path.join(root, l);
    const selectedLangDir = langDir;
    if (!(await exists(selectedLangDir))) {
      continue;
    }
    const entries = await fsp.readdir(selectedLangDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) {
        continue;
      }
      const tmpl = e.name;
      const tmplDir = path.join(selectedLangDir, tmpl);
      const metaPath = path.join(tmplDir, "meta.json");
      let meta: any = { language: requestedLanguage || l, template: tmpl };
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
        language: requestedLanguage || l,
        template: tmpl,
        description: meta.description || "",
        help: meta.help || {},
        variables,
      });
    }
  }
  return out;
}
