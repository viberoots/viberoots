import * as fsp from "node:fs/promises";
import path from "node:path";

export const TEMPLATE_MANIFEST_PATH = "build-tools/tools/scaffolding/template-manifest.json";
export const GENERATED_TAXONOMY_TS_PATH =
  "build-tools/tools/scaffolding/scaf/templates/generated/template-taxonomy.generated.ts";
export const GENERATED_ADAPTER_BZL_PATH = "build-tools/tools/tests/template_taxonomy_adapter.bzl";
export const GENERATED_RESOLVER_JSON_PATH = "build-tools/tools/scaffolding/resolver.json";

type TemplateManifestEntry = {
  language: string;
  template: string;
  templateRoot: string;
  resolverDestination?: string;
};

type TemplateManifest = {
  templateNameAliases: Record<string, string>;
  resolverDefaults: Record<string, string>;
  templates: TemplateManifestEntry[];
};

function stableSorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function stableUniqueSorted(values: readonly string[]): string[] {
  return stableSorted(Array.from(new Set(values)));
}

function assertValidEntry(entry: TemplateManifestEntry): void {
  if (!entry.language || !entry.template || !entry.templateRoot) {
    throw new Error("template manifest entry must define language, template, and templateRoot");
  }
}

export async function readTemplateManifest(): Promise<TemplateManifest> {
  const raw = await fsp.readFile(TEMPLATE_MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw) as TemplateManifest;
  const aliases = parsed.templateNameAliases || {};
  const defaults = parsed.resolverDefaults || {};
  const templates = parsed.templates || [];
  const ids = new Set<string>();
  for (const entry of templates) {
    assertValidEntry(entry);
    const id = `${entry.language}/${entry.template}`;
    if (ids.has(id)) throw new Error(`duplicate canonical template id in manifest: ${id}`);
    ids.add(id);
  }
  return {
    templateNameAliases: aliases,
    resolverDefaults: defaults,
    templates: stableSorted(templates.map((t) => JSON.stringify(t))).map(
      (t) => JSON.parse(t) as TemplateManifestEntry,
    ),
  };
}

export function canonicalTemplateIdsFromManifest(manifest: TemplateManifest): string[] {
  return stableUniqueSorted(manifest.templates.map((t) => `${t.language}/${t.template}`));
}

export function taxonomyFromManifest(
  manifest: TemplateManifest,
): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, string[]> = {};
  for (const entry of manifest.templates) {
    if (!out[entry.language]) out[entry.language] = [];
    out[entry.language].push(entry.template);
  }
  const normalized: Record<string, readonly string[]> = {};
  for (const lang of stableSorted(Object.keys(out))) {
    normalized[lang] = stableUniqueSorted(out[lang]);
  }
  return normalized;
}

export function resolverFromManifest(
  manifest: TemplateManifest,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {
    default: { ...manifest.resolverDefaults },
  };
  for (const entry of manifest.templates) {
    if (!entry.resolverDestination) continue;
    if (!out[entry.language]) out[entry.language] = {};
    out[entry.language][entry.template] = entry.resolverDestination;
  }
  const normalized: Record<string, Record<string, string>> = {};
  for (const lang of stableSorted(Object.keys(out))) {
    const row = out[lang] || {};
    normalized[lang] = {};
    for (const template of stableSorted(Object.keys(row))) {
      normalized[lang][template] = row[template];
    }
  }
  return normalized;
}

function renderTsObject(map: Record<string, string>): string {
  const keys = stableSorted(Object.keys(map));
  if (keys.length === 0) return "{}";
  return `{\n${keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`).join("\n")}\n}`;
}

export function renderGeneratedTaxonomyTs(manifest: TemplateManifest): string {
  const taxonomy = taxonomyFromManifest(manifest);
  const taxonomyKeys = stableSorted(Object.keys(taxonomy));
  const taxonomyBody =
    "{\n" +
    taxonomyKeys
      .map((lang) => {
        const names = taxonomy[lang] || [];
        const list =
          names.length <= 3
            ? `[${names.map((name) => JSON.stringify(name)).join(", ")}]`
            : `[\n${names.map((name) => `    ${JSON.stringify(name)},`).join("\n")}\n  ]`;
        return `  ${JSON.stringify(lang)}: ${list},`;
      })
      .join("\n") +
    "\n} as const";
  return [
    "// GENERATED FILE — DO NOT EDIT.",
    `// Rendered from ${TEMPLATE_MANIFEST_PATH}`,
    "",
    `export const TEMPLATE_NAME_ALIASES: Record<string, string> = ${renderTsObject(manifest.templateNameAliases)};`,
    "",
    `export const TEMPLATE_TAXONOMY = ${taxonomyBody};`,
    "",
  ].join("\n");
}

export function renderTemplateTaxonomyAdapterBzl(manifest: TemplateManifest): string {
  const ids = canonicalTemplateIdsFromManifest(manifest);
  const idLines = ids.map((id) => `    ${JSON.stringify(id)},`).join("\n");
  return [
    "# GENERATED FILE — DO NOT EDIT.",
    `# Rendered from ${TEMPLATE_MANIFEST_PATH}`,
    "",
    "CANONICAL_TEMPLATE_IDS = [",
    idLines,
    "]",
    "",
    "CANONICAL_TEMPLATE_ID_SET = {template_id: True for template_id in CANONICAL_TEMPLATE_IDS}",
    "",
    "def canonical_template_id(language, template):",
    '    template_id = "%s/%s" % (language, template)',
    "    if not CANONICAL_TEMPLATE_ID_SET.get(template_id, False):",
    '        fail("unknown canonical template id: %s" % template_id)',
    "    return template_id",
    "",
  ].join("\n");
}

export function renderResolverJson(manifest: TemplateManifest): string {
  return JSON.stringify(resolverFromManifest(manifest), null, 2) + "\n";
}

export async function readGeneratedFile(relPath: string): Promise<string> {
  const abs = path.resolve(relPath);
  return fsp.readFile(abs, "utf8");
}
