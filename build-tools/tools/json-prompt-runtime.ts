import {
  type JsonPromptObject,
  type JsonPromptOptions,
  type JsonPromptResolution,
  type JsonPromptRuntime,
  type JsonPromptValue,
} from "./json-prompt-types";
import { isUnsetValue, parsePromptAnswer } from "./json-prompt-values";

export function formatPromptDefault(value: JsonPromptValue): string {
  return typeof value === "string" ? value : String(value);
}

export function orderedPromptKeys(
  inputObject: JsonPromptObject,
  options: Pick<JsonPromptOptions, "fieldKeys" | "order">,
): string[] {
  const ordered = [...options.order];
  for (const key of options.fieldKeys) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  for (const key of Object.keys(inputObject)) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

export function expandPromptFieldUniverse(
  inputObject: JsonPromptObject,
  options: Pick<JsonPromptOptions, "fieldKeys" | "order">,
): JsonPromptObject {
  const expanded: JsonPromptObject = { ...inputObject };
  for (const key of orderedPromptKeys(inputObject, options)) {
    if (!(key in expanded)) expanded[key] = null;
  }
  return expanded;
}

function matchesCondition(
  condition: Record<string, JsonPromptValue>,
  current: JsonPromptObject,
): boolean {
  return Object.entries(condition).every(([key, value]) => current[key] === value);
}

export function isFieldRequired(
  key: string,
  current: JsonPromptObject,
  options: Pick<JsonPromptOptions, "required" | "requiredWhen">,
): boolean {
  if (options.required.has(key)) return true;
  return options.requiredWhen.some(
    (rule) => rule.require.includes(key) && matchesCondition(rule.if, current),
  );
}

export function resolveTemplateDefault(
  template: string,
  current: JsonPromptObject,
): string | undefined {
  let missing = false;
  const rendered = template.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
    const value = current[key];
    if (value === null || value === undefined || value === "") {
      missing = true;
      return "";
    }
    return String(value);
  });
  return missing ? undefined : rendered;
}

export function resolveDefaultValue(
  key: string,
  current: JsonPromptObject,
  options: Pick<JsonPromptOptions, "defaults" | "fieldTypes" | "defaultTemplates">,
): JsonPromptValue | undefined {
  if (options.defaults[key] !== undefined) return options.defaults[key];
  const template = options.defaultTemplates[key];
  if (!template) return undefined;
  const resolved = resolveTemplateDefault(template, current);
  if (resolved === undefined) return undefined;
  return parsePromptAnswer(resolved, options.fieldTypes[key]);
}

export function renderPromptText(
  key: string,
  current: JsonPromptObject,
  options: Pick<JsonPromptOptions, "labels" | "defaults" | "fieldTypes" | "defaultTemplates">,
): string {
  const label = options.labels[key] || key;
  const defaultValue = resolveDefaultValue(key, current, options);
  return defaultValue === undefined
    ? `${label}: `
    : `${label} [${formatPromptDefault(defaultValue)}]: `;
}

export function resolvePromptResponse(
  key: string,
  answer: string,
  current: JsonPromptObject,
  options: Pick<
    JsonPromptOptions,
    "defaults" | "fieldTypes" | "defaultTemplates" | "required" | "requiredWhen"
  >,
): JsonPromptResolution {
  if (!answer.trim()) {
    const defaultValue = resolveDefaultValue(key, current, options);
    if (defaultValue !== undefined) return { kind: "set", value: defaultValue };
    if (isFieldRequired(key, current, options)) {
      return { kind: "retry", reason: "value is required" };
    }
    return { kind: "omit" };
  }

  return { kind: "set", value: parsePromptAnswer(answer, options.fieldTypes[key]) };
}

export function applyPromptDefaults(
  inputObject: JsonPromptObject,
  options: Pick<
    JsonPromptOptions,
    | "fieldKeys"
    | "order"
    | "defaults"
    | "fieldTypes"
    | "defaultTemplates"
    | "required"
    | "requiredWhen"
  >,
): { output: JsonPromptObject; missingRequired: string[] } {
  const current = expandPromptFieldUniverse(inputObject, options);
  const output: JsonPromptObject = {};
  const missingRequired: string[] = [];

  for (const key of orderedPromptKeys(current, options)) {
    const value = current[key];
    if (!isUnsetValue(value)) {
      output[key] = value;
      continue;
    }

    const defaultValue = resolveDefaultValue(key, current, options);
    if (defaultValue !== undefined) {
      current[key] = defaultValue;
      output[key] = defaultValue;
      continue;
    }

    if (isFieldRequired(key, current, options)) {
      missingRequired.push(key);
    }
  }

  return { output, missingRequired };
}

export async function completeJsonPromptObject(
  inputObject: JsonPromptObject,
  options: JsonPromptOptions,
  runtime?: JsonPromptRuntime,
): Promise<JsonPromptObject> {
  const prefilled = applyPromptDefaults(inputObject, options);
  const workingObject = expandPromptFieldUniverse(prefilled.output, options);
  const keys = orderedPromptKeys(workingObject, options).filter((key) =>
    isUnsetValue(workingObject[key]),
  );
  if (!keys.length) return prefilled.output;

  if (!runtime?.interactive || !runtime.prompt) {
    if (!prefilled.missingRequired.length) return prefilled.output;
    throw new Error(`missing values for: ${prefilled.missingRequired.join(", ")}`);
  }

  for (const key of keys) {
    while (isUnsetValue(workingObject[key])) {
      const answer = await runtime.prompt(renderPromptText(key, workingObject, options));
      try {
        const resolution = resolvePromptResponse(key, answer, workingObject, options);
        if (resolution.kind === "set") {
          workingObject[key] = resolution.value;
          break;
        }
        if (resolution.kind === "omit") {
          delete workingObject[key];
          break;
        }
        runtime.onRetry?.(resolution.reason);
      } catch (error) {
        runtime.onRetry?.(String(error instanceof Error ? error.message : error));
      }
    }
  }

  return Object.fromEntries(
    Object.entries(workingObject).filter(([, value]) => !isUnsetValue(value)),
  ) as JsonPromptObject;
}
