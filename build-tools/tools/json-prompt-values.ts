import {
  type JsonPromptFieldType,
  type JsonPromptNamedArgMode,
  type JsonPromptObject,
  type JsonPromptPrimitive,
  type JsonPromptValue,
} from "./json-prompt-types";

function parseJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${source}: failed to parse JSON (${String(error)})`);
  }
}

function normalizeFlatValue(value: unknown): JsonPromptPrimitive | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return undefined;
  throw new Error("expected a flat object containing only primitive values");
}

export function isAllowedValue(value: unknown): value is JsonPromptPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function parseJsonPromptObject(raw: string): JsonPromptObject {
  const parsed = parseJson(raw, "json-prompt input");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected a top-level JSON object");
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!isAllowedValue(value)) {
      throw new Error(
        `field "${key}" must be a primitive JSON value or null (objects and arrays are not supported)`,
      );
    }
  }

  return parsed as JsonPromptObject;
}

export function mergeFlatPromptObjects(
  ...sources: Array<Record<string, unknown> | undefined>
): JsonPromptObject {
  const merged: JsonPromptObject = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      const normalized = normalizeFlatValue(value);
      if (normalized !== undefined) merged[key] = normalized;
    }
  }
  return merged;
}

export function isUnsetValue(value: JsonPromptPrimitive): boolean {
  return value === null || value === "";
}

export function shouldEmitNothingForRawInput(raw: string): boolean {
  return raw.trim() === "";
}

export function formatNamedArgsOutput(
  inputObject: JsonPromptObject,
  namedArgModes: Record<string, JsonPromptNamedArgMode> = {},
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(inputObject)) {
    if (isUnsetValue(value)) continue;
    const mode = namedArgModes[key] || "pair";
    if (mode === "flag") {
      if (typeof value !== "boolean") {
        throw new Error(`field "${key}" must be boolean when namedArgModes.${key} is "flag"`);
      }
      if (value) lines.push(`--${key}`);
      continue;
    }
    const rendered = String(value);
    if (rendered.includes("\n")) {
      throw new Error(
        `field "${key}" cannot be rendered as named args because it contains a newline`,
      );
    }
    lines.push(`--${key}`, rendered);
  }
  return lines.join("\n");
}

function parseTypedPromptAnswer(answer: string, fieldType: JsonPromptFieldType): JsonPromptValue {
  const trimmed = answer.trim();
  if (!trimmed) {
    throw new Error("value is required");
  }

  if (fieldType === "string") return trimmed;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (fieldType === "number" && typeof parsed === "number") return parsed;
    if (fieldType === "boolean" && typeof parsed === "boolean") return parsed;
  } catch {
    // Fall through to the typed error below.
  }

  throw new Error(`expected a ${fieldType}`);
}

export function parsePromptAnswer(
  answer: string,
  fieldType?: JsonPromptFieldType,
): JsonPromptValue {
  const trimmed = answer.trim();
  if (!trimmed) {
    throw new Error("value is required");
  }
  if (fieldType) return parseTypedPromptAnswer(answer, fieldType);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed !== null && isAllowedValue(parsed)) {
      return parsed;
    }
  } catch {
    // Fall back to a plain string for unquoted input like foo@example.com.
  }

  return trimmed;
}
