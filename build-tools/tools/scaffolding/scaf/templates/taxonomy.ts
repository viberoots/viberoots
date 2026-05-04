import { TEMPLATE_NAME_ALIASES, TEMPLATE_TAXONOMY } from "./generated/template-taxonomy.generated";
export { TEMPLATE_NAME_ALIASES, TEMPLATE_TAXONOMY };

type CanonicalTemplateLanguage = keyof typeof TEMPLATE_TAXONOMY;
type CanonicalTemplateId = `${CanonicalTemplateLanguage}/${string}`;

function sortedUnique(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function templateIdsForLanguage(language: string): string[] {
  const names = TEMPLATE_TAXONOMY[language as CanonicalTemplateLanguage] || [];
  return names.map((template) => `${language}/${template}`);
}

export const CANONICAL_TEMPLATE_IDS = sortedUnique(
  Object.keys(TEMPLATE_TAXONOMY).flatMap((language) => templateIdsForLanguage(language)),
);
export const CANONICAL_TEMPLATE_ID_SET = new Set<string>(CANONICAL_TEMPLATE_IDS);

const CANONICAL_TS_TEMPLATE_NAMES = TEMPLATE_TAXONOMY.ts;
const CANONICAL_TS_TEMPLATE_SET = new Set<string>(CANONICAL_TS_TEMPLATE_NAMES);
export const CANONICAL_TS_TEMPLATE_IDS = templateIdsForLanguage("ts");
export const CANONICAL_TS_TEMPLATE_ID_SET = new Set<string>(CANONICAL_TS_TEMPLATE_IDS);

export function normalizeTemplateName(name: string): string {
  const key = String(name || "").trim();
  return TEMPLATE_NAME_ALIASES[key] || key;
}

export function isCanonicalTypeScriptTemplate(templateName: string): boolean {
  return CANONICAL_TS_TEMPLATE_SET.has(normalizeTemplateName(templateName));
}

export function canonicalTemplateLanguage(language: string, _templateName: string): string {
  return language;
}

export function canonicalTemplateRootLanguage(language: string): string {
  return language;
}

export function hasCanonicalTemplateId(templateId: string): boolean {
  return CANONICAL_TEMPLATE_ID_SET.has(String(templateId || "").trim());
}

export function canonicalTemplateIdsForLanguage(language: string): string[] {
  return templateIdsForLanguage(String(language || "").trim());
}

export function assertCanonicalTemplateIdsUnique(ids: readonly string[]): void {
  const normalized = ids.map((id) => String(id || "").trim()).filter(Boolean);
  if (normalized.length !== new Set(normalized).size) {
    throw new Error("duplicate canonical template id detected");
  }
}
