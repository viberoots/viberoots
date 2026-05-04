import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs";
import { isLanguageEnabled } from "../language-enablement";
import { canonicalTemplateIdsForLanguage, TEMPLATE_TAXONOMY } from "./taxonomy";
import { readCopierVariables } from "./variables";

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
  const strictCanonicalRoots = requestedLanguage !== "";
  let langs = requestedLanguage ? [requestedLanguage] : Object.keys(TEMPLATE_TAXONOMY);

  const filtered: string[] = [];
  for (const l of langs) {
    if (await isLanguageEnabled(l)) filtered.push(l);
  }
  langs = filtered;

  const out: TemplateMetaRow[] = [];
  for (const l of langs) {
    const canonicalIds = canonicalTemplateIdsForLanguage(l);
    for (const id of canonicalIds) {
      const tmpl = id.split("/")[1] || "";
      const tmplDir = path.join(root, l, tmpl);
      if (!(await exists(tmplDir))) {
        if (strictCanonicalRoots) {
          throw new Error(
            `[scaf templates] missing template root for canonical id '${id}' at ${tmplDir}`,
          );
        }
        continue;
      }
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
