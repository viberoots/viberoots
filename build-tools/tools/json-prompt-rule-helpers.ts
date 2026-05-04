import {
  type JsonPromptDefaults,
  type JsonPromptLabels,
  type JsonPromptRuleSet,
} from "./json-prompt-types";

export function parseRulesJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${source}: failed to parse JSON (${String(error)})`);
  }
}

export function requireKnownKey(key: string, knownKeys: Set<string>, source: string) {
  if (!knownKeys.has(key)) {
    throw new Error(`unknown field "${key}" in ${source}`);
  }
}

export function collectDeclaredRuleKeys(rules: JsonPromptRuleSet): string[] {
  const keys = new Set<string>();
  for (const key of rules.order || []) keys.add(key);
  for (const key of Object.keys(rules.labels || {})) keys.add(key);
  for (const key of rules.required || []) keys.add(key);
  for (const key of Object.keys(rules.defaults || {})) keys.add(key);
  for (const key of Object.keys(rules.fieldTypes || {})) keys.add(key);
  for (const key of Object.keys(rules.namedArgModes || {})) keys.add(key);
  for (const key of Object.keys(rules.defaultTemplates || {})) keys.add(key);
  for (const key of Object.values(rules.reservedFlagsAsFields || {})) keys.add(key);
  for (const rule of rules.requiredWhen || []) {
    for (const key of Object.keys(rule.if || {})) keys.add(key);
    for (const key of rule.require || []) keys.add(key);
  }
  return [...keys];
}

export function collectDeclaredArgKeys(argv: string[]): string[] {
  const keys = new Set<string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    if (arg === "--required" || arg.startsWith("--required=")) {
      const value = arg.startsWith("--required=") ? arg.slice("--required=".length).trim() : "";
      if (value) keys.add(value);
      continue;
    }
    if (arg.startsWith("--default-")) {
      const option = arg.slice("--default-".length);
      const separatorIndex = option.indexOf("=");
      const key = (separatorIndex >= 0 ? option.slice(0, separatorIndex) : option).trim();
      if (key) keys.add(key);
      continue;
    }
    const option = arg.slice(2).trim();
    const separatorIndex = option.indexOf("=");
    const key = (separatorIndex >= 0 ? option.slice(0, separatorIndex) : option).trim();
    if (key && key !== "rules" && key !== "rules-file" && key !== "output") keys.add(key);
  }
  return [...keys];
}

export function readOptionValue(
  argv: string[],
  index: number,
): { value: string; nextIndex: number } {
  const current = argv[index] ?? "";
  const separatorIndex = current.indexOf("=");
  if (separatorIndex >= 0) {
    return { value: current.slice(separatorIndex + 1).trim(), nextIndex: index };
  }

  const next = (argv[index + 1] || "").trim();
  return { value: next, nextIndex: next ? index + 1 : index };
}

export function rewriteReservedFieldFlags(argv: string[], rules: JsonPromptRuleSet): string[] {
  const mappings = Object.entries(rules.reservedFlagsAsFields || {});
  if (!mappings.length) return argv;
  return argv.map((arg) => {
    for (const [flag, field] of mappings) {
      if (arg === flag) return `--${field}`;
      if (flag.startsWith("--") && arg.startsWith(`${flag}=`)) {
        return `--${field}=${arg.slice(flag.length + 1)}`;
      }
    }
    return arg;
  });
}

export function mergeRuleDefaults(
  base: JsonPromptDefaults,
  next: JsonPromptDefaults | undefined,
): JsonPromptDefaults {
  return { ...base, ...(next || {}) };
}

export function mergeRuleLabels(
  base: JsonPromptLabels,
  next: JsonPromptLabels | undefined,
): JsonPromptLabels {
  return { ...base, ...(next || {}) };
}
