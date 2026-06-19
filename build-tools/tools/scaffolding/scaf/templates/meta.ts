import path from "node:path";

import * as fsp from "node:fs/promises";

import { exists } from "../fs";
import { isLanguageEnabled } from "../language-enablement";
import { templateRootPath } from "./paths";
import { canonicalTemplateIdsForLanguage } from "./taxonomy";
import { readCopierVariables } from "./variables";

export type TemplateMetaRow = {
  language: string;
  template: string;
  description: string;
  help: any;
  variables: string[];
};

export type ReadTemplateMetaOptions = {
  tolerateStaleTaxonomy?: boolean;
};

async function templateLanguages(root: string): Promise<string[]> {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function templatesForLanguage(root: string, language: string): Promise<string[]> {
  const entries = await fsp
    .readdir(path.join(root, language), { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function orderTemplatesForListing(actualTemplates: string[], canonicalIds: string[]): string[] {
  const actual = new Set(actualTemplates);
  const canonicalNames = canonicalIds
    .map((id) => id.split("/")[1] || "")
    .filter((name) => name && actual.has(name));
  const seen = new Set(canonicalNames);
  const uncategorized = actualTemplates.filter((name) => !seen.has(name));
  return [...canonicalNames, ...uncategorized];
}

export async function readTemplateMeta(
  language?: string,
  opts: ReadTemplateMetaOptions = {},
): Promise<TemplateMetaRow[]> {
  const root = templateRootPath();
  const requestedLanguage = language ? String(language).trim() : "";
  let langs = requestedLanguage ? [requestedLanguage] : await templateLanguages(root);

  const filtered: string[] = [];
  for (const l of langs) {
    if (await isLanguageEnabled(l)) filtered.push(l);
  }
  langs = filtered;

  const out: TemplateMetaRow[] = [];
  for (const l of langs) {
    const actualTemplates = await templatesForLanguage(root, l);
    const canonicalIds = requestedLanguage ? canonicalTemplateIdsForLanguage(l) : [];
    const templates =
      requestedLanguage && !opts.tolerateStaleTaxonomy
        ? canonicalIds.map((id) => id.split("/")[1] || "").filter(Boolean)
        : orderTemplatesForListing(actualTemplates, canonicalIds);
    for (const tmpl of templates) {
      const id = `${l}/${tmpl}`;
      const tmplDir = path.join(root, l, tmpl);
      if (!(await exists(tmplDir))) {
        throw new Error(`missing template root for canonical id '${id}'`);
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
