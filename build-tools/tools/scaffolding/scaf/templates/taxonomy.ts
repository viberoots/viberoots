const TEMPLATE_NAME_ALIASES: Record<string, string> = {
  library: "lib",
  "cli-app": "cli",
  "ts-go-cpp-lib": "go-cpp-lib",
};

const CANONICAL_TS_TEMPLATE_NAMES = [
  "lib",
  "cli",
  "webapp-static",
  "webapp-ssr-express",
  "webapp-ssr-next",
  "cpp-addon",
  "go-addon",
  "wasm-inline",
  "wasm-app",
  "wasm-linking-app",
  "go-cpp-lib",
] as const;

const CANONICAL_TS_TEMPLATE_SET = new Set<string>(CANONICAL_TS_TEMPLATE_NAMES);

export const CANONICAL_TS_TEMPLATE_IDS = CANONICAL_TS_TEMPLATE_NAMES.map(
  (template) => `ts/${template}`,
);

export function normalizeTemplateName(name: string): string {
  const key = String(name || "").trim();
  return TEMPLATE_NAME_ALIASES[key] || key;
}

export function isCanonicalTypeScriptTemplate(templateName: string): boolean {
  return CANONICAL_TS_TEMPLATE_SET.has(normalizeTemplateName(templateName));
}

export function canonicalTemplateLanguage(language: string, templateName: string): string {
  const normalizedTemplate = normalizeTemplateName(templateName);
  if (language === "node" && isCanonicalTypeScriptTemplate(normalizedTemplate)) {
    return "ts";
  }
  return language;
}

export function canonicalTemplateRootLanguage(language: string): string {
  return language === "node" ? "ts" : language;
}
