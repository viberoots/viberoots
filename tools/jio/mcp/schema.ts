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
    const { z } = await import("zod");
    const build = (s: any): any => {
      if (!s || typeof s !== "object") return (z as any).any();
      if (s.const !== undefined) return (z as any).literal(s.const);
      if (Array.isArray(s.enum)) {
        const vals = s.enum;
        if (vals.every((v: any) => typeof v === "string")) return (z as any).enum(vals);
        return (z as any).union(vals.map((v: any) => (z as any).literal(v)));
      }
      const t = s.type;
      if (Array.isArray(t)) {
        const nonNull = t.filter((x: any) => x !== "null");
        if (nonNull.length === 1 && t.includes("null"))
          return build({ ...s, type: nonNull[0] }).nullable();
        return (z as any).union(t.map((x: any) => build({ ...s, type: x })));
      }
      switch (t) {
        case "string": {
          let zz: any = (z as any).string();
          if (typeof s.minLength === "number") zz = zz.min(s.minLength);
          if (typeof s.maxLength === "number") zz = zz.max(s.maxLength);
          if (typeof s.pattern === "string") {
            try {
              zz = zz.regex(new RegExp(s.pattern));
            } catch {}
          }
          if (typeof s.format === "string") {
            if (s.format === "email") zz = zz.email?.() || zz;
            if (s.format === "uuid") zz = zz.uuid?.() || zz;
            if (s.format === "url") zz = zz.url?.() || zz;
            if (s.format === "date-time") zz = zz.datetime?.() || zz;
          }
          return zz;
        }
        case "number": {
          let zz: any = (z as any).number();
          if (typeof s.minimum === "number") zz = zz.min(s.minimum);
          if (typeof s.maximum === "number") zz = zz.max(s.maximum);
          return zz;
        }
        case "integer": {
          let zz: any = (z as any).number().int();
          if (typeof s.minimum === "number") zz = zz.min(s.minimum);
          if (typeof s.maximum === "number") zz = zz.max(s.maximum);
          return zz;
        }
        case "boolean":
          return (z as any).boolean();
        case "null":
          return (z as any).null();
        case "array": {
          const item = build(s.items || {});
          let zz: any = (z as any).array(item);
          if (typeof s.minItems === "number") zz = zz.min(s.minItems);
          if (typeof s.maxItems === "number") zz = zz.max(s.maxItems);
          return zz;
        }
        case "object": {
          const props = s.properties && typeof s.properties === "object" ? s.properties : {};
          const required = Array.isArray(s.required) ? new Set(s.required) : new Set<string>();
          const shapeEntries = Object.entries(props).map(([k, v]: any) => {
            const base = build(v);
            const node = required.has(k) ? base : base.optional();
            return [k, node];
          });
          let obj: any = (z as any).object(Object.fromEntries(shapeEntries));
          // Model JSON Schema additionalProperties semantics:
          // - false => reject unknown keys (strict)
          // - schema => validate unknown keys against that schema (catchall)
          // - true/undefined => allow unknown keys (passthrough)
          if (s.additionalProperties === false) {
            obj = obj.strict?.() || obj;
          } else if (s.additionalProperties && typeof s.additionalProperties === "object") {
            try {
              const extra = build(s.additionalProperties);
              obj = obj.catchall?.(extra) || obj;
            } catch {
              obj = obj.passthrough?.() || obj;
            }
          } else {
            obj = obj.passthrough?.() || obj;
          }
          return obj;
        }
      }
      return (z as any).any();
    };
    const zodInstance = build(schema);
    convCache.set(key, zodInstance);
    return { zod: zodInstance };
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
  kind?: "input" | "output" | "requested";
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
