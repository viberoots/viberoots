import * as fsp from "node:fs/promises";

import {
  type JsonPromptObject,
  type JsonPromptOptions,
  type JsonPromptRuleSet,
  type JsonPromptRuleSource,
} from "./json-prompt-types";
import {
  collectDeclaredArgKeys,
  collectDeclaredRuleKeys,
  mergeRuleDefaults,
  mergeRuleLabels,
  parseRulesJson,
  readOptionValue,
  requireKnownKey,
  rewriteReservedFieldFlags,
} from "./json-prompt-rule-helpers";
import { isAllowedValue, parsePromptAnswer } from "./json-prompt-values";

export async function extractPromptRuleSource(
  argv: string[],
  readFile: (filePath: string) => Promise<string> = (filePath) => fsp.readFile(filePath, "utf8"),
): Promise<JsonPromptRuleSource> {
  const optionArgs: string[] = [];
  let inlineRules: string | undefined;
  let fileRules: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--rules" || arg.startsWith("--rules=")) {
      const { value, nextIndex } = readOptionValue(argv, index);
      if (!value) throw new Error("prompt rules JSON must not be empty");
      inlineRules = value;
      index = nextIndex;
      continue;
    }
    if (arg === "--rules-file" || arg.startsWith("--rules-file=")) {
      const { value, nextIndex } = readOptionValue(argv, index);
      if (!value) throw new Error("prompt rules file path must not be empty");
      fileRules = await readFile(value);
      index = nextIndex;
      continue;
    }
    optionArgs.push(arg);
  }

  return { optionArgs, rulesRaw: inlineRules ?? fileRules };
}

export function parsePromptRuleSet(rawRulesJson: string | undefined): JsonPromptRuleSet {
  if (!rawRulesJson) return {};
  const parsed = parseRulesJson(rawRulesJson, "json-prompt rules");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("json-prompt rules: expected a top-level object");
  }
  const rules = parsed as JsonPromptRuleSet;
  for (const [key, value] of Object.entries(rules.defaults || {})) {
    if (!isAllowedValue(value) || value === null) {
      throw new Error(`rules defaults for "${key}" must be a non-null primitive`);
    }
  }
  for (const [key, fieldType] of Object.entries(rules.fieldTypes || {})) {
    if (fieldType !== "string" && fieldType !== "number" && fieldType !== "boolean") {
      throw new Error(`rules fieldTypes for "${key}" must be string, number, or boolean`);
    }
  }
  for (const [key, mode] of Object.entries(rules.namedArgModes || {})) {
    if (mode !== "pair" && mode !== "flag") {
      throw new Error(`rules namedArgModes for "${key}" must be pair or flag`);
    }
    if (mode === "flag" && rules.fieldTypes?.[key] && rules.fieldTypes[key] !== "boolean") {
      throw new Error(
        `rules namedArgModes for "${key}" cannot be flag unless fieldTypes.${key} is boolean`,
      );
    }
  }
  for (const [key, template] of Object.entries(rules.defaultTemplates || {})) {
    if (!template.trim()) throw new Error(`rules default template for "${key}" must not be empty`);
  }
  for (const rule of rules.requiredWhen || []) {
    for (const [key, value] of Object.entries(rule.if || {})) {
      if (!isAllowedValue(value) || value === null) {
        throw new Error(`rules requiredWhen.if for "${key}" must be a non-null primitive`);
      }
    }
  }
  for (const [flag, field] of Object.entries(rules.reservedFlagsAsFields || {})) {
    if (!flag.startsWith("-")) {
      throw new Error(`rules reservedFlagsAsFields key "${flag}" must start with "-"`);
    }
    if (!field.trim()) {
      throw new Error(`rules reservedFlagsAsFields field for "${flag}" must not be empty`);
    }
  }
  for (const [key, value] of Object.entries(rules.defaults || {})) {
    const fieldType = rules.fieldTypes?.[key];
    if (
      fieldType &&
      ((fieldType === "string" && typeof value !== "string") ||
        (fieldType === "number" && typeof value !== "number") ||
        (fieldType === "boolean" && typeof value !== "boolean"))
    ) {
      throw new Error(`rules defaults for "${key}" must be a ${fieldType}`);
    }
  }

  return rules;
}

function buildPromptOptions(
  argv: string[],
  inputObject: JsonPromptObject,
  rules: JsonPromptRuleSet,
): JsonPromptOptions {
  const normalizedArgv = rewriteReservedFieldFlags(argv, rules);
  const knownKeys = new Set([
    ...Object.keys(inputObject),
    ...collectDeclaredRuleKeys(rules),
    ...collectDeclaredArgKeys(normalizedArgv),
  ]);
  const labels = mergeRuleLabels({}, rules.labels);
  const defaults = mergeRuleDefaults({}, rules.defaults);
  const fieldTypes = { ...(rules.fieldTypes || {}) };
  const namedArgModes = { ...(rules.namedArgModes || {}) };
  const required = new Set<string>(rules.required || []);
  const defaultTemplates = { ...(rules.defaultTemplates || {}) };
  const order = Array.from(new Set((rules.order || []).filter((key) => knownKeys.has(key))));
  const requiredWhen = [...(rules.requiredWhen || [])];

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index] ?? "";
    if (!arg.startsWith("--")) {
      throw new Error(
        `invalid prompt option "${arg}" (expected --field label, --field=label, --required field, or --default-field value)`,
      );
    }

    if (arg === "--required" || arg.startsWith("--required=")) {
      const { value, nextIndex } = readOptionValue(normalizedArgv, index);
      if (!value) throw new Error("required field name must not be empty");
      requireKnownKey(value, knownKeys, "required field");
      required.add(value);
      index = nextIndex;
      continue;
    }

    if (arg.startsWith("--default-")) {
      const option = arg.slice("--default-".length);
      const separatorIndex = option.indexOf("=");
      const key = (separatorIndex >= 0 ? option.slice(0, separatorIndex) : option).trim();
      if (!key) throw new Error(`invalid prompt default option "${arg}"`);
      requireKnownKey(key, knownKeys, "prompt default");
      const { value, nextIndex } = readOptionValue(normalizedArgv, index);
      if (!value) throw new Error(`default value for "${key}" must not be empty`);
      defaults[key] = parsePromptAnswer(value, fieldTypes[key]);
      index = nextIndex;
      continue;
    }

    const option = arg.slice(2).trim();
    const separatorIndex = option.indexOf("=");
    const key = (separatorIndex >= 0 ? option.slice(0, separatorIndex) : option).trim();
    requireKnownKey(key, knownKeys, "prompt label");
    const { value, nextIndex } = readOptionValue(normalizedArgv, index);
    if (!value) throw new Error(`prompt label for "${key}" must not be empty`);
    labels[key] = value;
    index = nextIndex;
  }

  return {
    fieldKeys: [...knownKeys],
    order,
    labels,
    defaults,
    fieldTypes,
    namedArgModes,
    required,
    requiredWhen,
    defaultTemplates,
  };
}

export function promptOptionsFromRuleSet(
  inputObject: JsonPromptObject,
  rules: JsonPromptRuleSet,
): JsonPromptOptions {
  return buildPromptOptions([], inputObject, rules);
}

export function parsePromptOptions(
  argv: string[],
  inputObject: JsonPromptObject,
  rawRulesJson?: string,
): JsonPromptOptions {
  return buildPromptOptions(argv, inputObject, parsePromptRuleSet(rawRulesJson));
}
