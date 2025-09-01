import { createHash } from "node:crypto";

type Reason = { keyword: string; pointer: string; note?: string };

function sha256(obj: any): string {
  try {
    const s = JSON.stringify(obj);
    return createHash("sha256").update(s).digest("hex");
  } catch {
    return "";
  }
}

export function scanUnsupportedFeatures(schema: any, basePointer = ""): Reason[] {
  const reasons: Reason[] = [];
  const visit = (node: any, ptr: string) => {
    if (!node || typeof node !== "object") return;
    for (const k of Object.keys(node)) {
      const v: any = (node as any)[k];
      const childPtr = `${ptr}/${k}`;
      switch (k) {
        case "anyOf":
        case "oneOf":
        case "allOf":
        case "if":
        case "then":
        case "else":
        case "not":
        case "$ref":
        case "$defs":
        case "patternProperties":
        case "dependentSchemas":
        case "unevaluatedProperties":
        case "propertyNames":
        case "contains":
          reasons.push({ keyword: k, pointer: childPtr });
          break;
        case "items":
          // tuple form (array) unsupported; only schema object is safe
          if (Array.isArray(v)) reasons.push({ keyword: "items(tuple)", pointer: childPtr });
          break;
        case "uniqueItems":
          // zod can't enforce uniqueness structurally
          if (v === true) reasons.push({ keyword: k, pointer: childPtr });
          break;
        case "additionalItems":
          reasons.push({ keyword: k, pointer: childPtr });
          break;
        case "exclusiveMinimum":
        case "exclusiveMaximum":
          // Supported conceptually, but we flag for conservatism in round-trip
          break;
      }
      if (v && typeof v === "object") visit(v, childPtr);
    }
  };
  visit(schema, basePointer || "");
  return reasons;
}

const convCache = new Map<string, any>();

export async function jsonSchemaToZodSafe(schema: any): Promise<{ zod?: any; reasons?: Reason[] }> {
  try {
    const reasons = scanUnsupportedFeatures(schema);
    if (reasons.length) return { reasons };
    const key = sha256(schema);
    if (convCache.has(key)) return { zod: convCache.get(key) };
    const { jsonSchemaToZod } = await import("json-schema-to-zod");
    const { z } = await import("zod");
    const zod = jsonSchemaToZod(schema, { module: "esm" }).schema;
    // Round-trip sanity via Zod 4 native conversion
    const round = (z as any).toJSONSchema(zod, { target: "draft-2020-12" });
    const diverged = !shallowComparableEqual(schema, round);
    if (diverged)
      return { reasons: [{ keyword: "roundTrip", pointer: "", note: "material divergence" }] };
    convCache.set(key, zod);
    return { zod };
  } catch (e) {
    return {
      reasons: [{ keyword: "exception", pointer: "", note: String((e as any)?.message || e) }],
    };
  }
}

export function getZodRawShape(zod: any): any | null {
  if (!zod || typeof zod !== "object") return null;
  try {
    // Zod 4: ZodObject has .shape getter
    if (zod.shape && typeof zod.shape === "object") return zod.shape;
    if (typeof zod.shape === "function") {
      const s = zod.shape();
      if (s && typeof s === "object") return s;
    }
    // Internal def fallback
    const def = (zod as any)._def;
    if (def?.shape && typeof def.shape === "function") return def.shape();
    if (def?.shape && typeof def.shape === "object") return def.shape;
  } catch {}
  return null;
}

function shallowComparableEqual(a: any, b: any): boolean {
  try {
    // Compare core: type, required, properties keys, items.kind
    const coreA = extractCore(a);
    const coreB = extractCore(b);
    return JSON.stringify(coreA) === JSON.stringify(coreB);
  } catch {
    return false;
  }
}

function extractCore(s: any): any {
  if (!s || typeof s !== "object") return s;
  const r: any = {};
  if (s.type) r.type = s.type;
  if (s.enum) r.enum = s.enum;
  if (s.const) r.const = s.const;
  if (s.required) r.required = [...s.required].sort();
  if (s.properties && typeof s.properties === "object") {
    r.properties = Object.fromEntries(
      Object.keys(s.properties)
        .sort()
        .map((k) => [k, extractCore(s.properties[k])]),
    );
  }
  if (s.items) r.items = Array.isArray(s.items) ? "tuple" : extractCore(s.items);
  if (s.minItems) r.minItems = s.minItems;
  if (s.maxItems) r.maxItems = s.maxItems;
  if (s.minimum !== undefined) r.minimum = s.minimum;
  if (s.maximum !== undefined) r.maximum = s.maximum;
  if (s.pattern) r.pattern = s.pattern;
  if (s.format) r.format = s.format;
  return r;
}

export function emitZodWarning(args: {
  tool: string;
  reasons: Reason[];
  schema: any;
  kind?: "input" | "output";
}) {
  try {
    if (process.env.JIO_MCP_ZOD_WARN === "0") return;
    const schemaHash = sha256(args.schema);
    const evt = {
      ts: Date.now(),
      type: "mcp.zodConversionSkipped",
      tool: args.tool,
      kind: args.kind || "input",
      reasons: args.reasons,
      schemaHash,
    };
    process.stderr.write(JSON.stringify(evt) + "\n");
    const human =
      `MCP: omitted Zod schema for ${args.tool} (${args.kind || "input"}): ` +
      args.reasons.map((r) => `${r.keyword} @ ${r.pointer || "/"}`).join("; ") +
      (process.env.JIO_DEBUG === "1" ? ` (${schemaHash})` : "");
    process.stderr.write(human + "\n");
  } catch {}
}
