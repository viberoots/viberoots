import Ajv from "ajv";
import { compileJsonPath } from "../jsonpath/index.ts";
import { createAjv } from "../validation/ajv.ts";

// Canonical JSON Schema (single source of truth) matching runner.ts behavior today
const JioSpecSchema: any = {
  $id: "https://static.kilty.io/jio/spec.schema.json",
  type: "object",
  required: ["tool", "command"],
  properties: {
    tool: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
      },
      additionalProperties: false,
    },
    command: {
      type: "object",
      required: ["package", "exec", "parameters"],
      properties: {
        package: { type: "string" },
        exec: { type: "string" },
        workingDir: { type: "string" },
        inheritCallerCwd: { type: "boolean", default: false },
        ignoreControlMessages: { type: "boolean", default: false },
        env: { type: "object", additionalProperties: { type: "string" } },
        defaultBooleanStyle: { type: "string", enum: ["presence", "equals"], default: "presence" },
        timeoutMs: { type: "integer", minimum: 1 },
        parameters: {
          type: "object",
          additionalProperties: {
            allOf: [
              {
                type: "object",
                properties: {
                  path: { type: "string", format: "jsonpath" },
                  value: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["string", "number", "boolean", "array", "object"],
                  },
                  required: { type: "boolean" },
                  default: {},
                  position: { type: "integer", minimum: 1 },
                  flag: { type: "boolean" },
                  flagName: { type: "string" },
                  flagValueStyle: { type: "string", enum: ["equals", "separate"] },
                  booleanStyle: { type: "string", enum: ["presence", "equals"] },
                  collectionStyle: {
                    type: "string",
                    enum: ["repeatArg", "repeatFlag", "csv", "kv", "separate"],
                  },
                  csvSeparator: { type: "string", maxLength: 1 },
                },
                anyOf: [
                  {
                    type: "object",
                    properties: { path: {}, type: {} },
                    required: ["path", "type"],
                  },
                  {
                    type: "object",
                    properties: { value: {}, type: {} },
                    required: ["value", "type"],
                  },
                  {
                    type: "object",
                    properties: { default: {}, type: {} },
                    required: ["default", "type"],
                  },
                ],
              },
              {
                if: { type: "object", required: ["flag"], properties: { flag: { const: true } } },
                then: {
                  anyOf: [
                    { type: "object", properties: { flagName: {} }, required: ["flagName"] },
                    {
                      type: "object",
                      properties: { type: { const: "object" }, collectionStyle: { const: "kv" } },
                    },
                  ],
                },
              },
            ],
          },
        },
        stdinTransform: {
          type: "object",
          properties: {
            shell: { type: "string" },
            format: { type: "string", enum: ["ndjson", "json"] },
          },
          additionalProperties: false,
        },
        // stdoutTransform optional per runner behavior
        stdoutTransform: {
          type: "object",
          properties: {
            shell: { type: "string" },
            format: { type: "string", enum: ["ndjson", "json"] },
          },
          required: ["shell", "format"],
          additionalProperties: false,
        },
        onValidationFailure: {
          type: "object",
          properties: { shell: { type: "string" } },
          required: ["shell"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    specVersion: { type: "string", const: "1.0.0" },
    schemaDialect: { type: "string", const: "https://json-schema.org/draft/2020-12/schema" },
  },
  additionalProperties: false,
};

let cachedSchemaJson: any | null = null;
export function toJsonSchema(): any {
  if (cachedSchemaJson) return cachedSchemaJson;
  cachedSchemaJson = JioSpecSchema;
  return cachedSchemaJson;
}

let cachedAjv: Ajv | null = null;
let cachedValidate: ((d: any) => boolean) | null = null;
export function createAjvValidator(): { ajv: Ajv; validate: (d: any) => boolean } {
  if (!cachedAjv) {
    cachedAjv = createAjv();
    cachedValidate = cachedAjv.compile(toJsonSchema());
  }
  return { ajv: cachedAjv, validate: cachedValidate! };
}

// Conservative fallback schema generator from parameter mappings
export function generateInputSchemaFromParameters(spec: any): any {
  const params =
    spec?.command?.parameters && typeof spec.command.parameters === "object"
      ? spec.command.parameters
      : {};
  const root: any = { type: "object", properties: {}, required: [], additionalProperties: true };

  function ensurePath(
    pathTokens: Array<string | { union: string[] } | { array: true }>,
    leafType: string,
    required: boolean,
  ) {
    let node = root;
    for (let i = 0; i < pathTokens.length; i++) {
      const tok = pathTokens[i];
      const isLast = i === pathTokens.length - 1;
      if (typeof tok === "string") {
        node.properties ||= {};
        node.required ||= [];
        if (!node.properties[tok])
          node.properties[tok] = { type: "object", properties: {}, additionalProperties: true };
        if (!isLast) node = node.properties[tok];
        else node.properties[tok] = typeNodeFor(leafType);
        if (required && isLast)
          node.required = Array.isArray(node.required)
            ? Array.from(new Set([...(node.required as string[]), tok]))
            : [tok];
      } else if ((tok as any).union) {
        for (const k of (tok as any).union) {
          node.properties ||= {};
          node.required ||= [];
          if (!node.properties[k])
            node.properties[k] = { type: "object", properties: {}, additionalProperties: true };
          if (isLast) node.properties[k] = typeNodeFor(leafType);
          if (required && isLast)
            node.required = Array.isArray(node.required)
              ? Array.from(new Set([...(node.required as string[]), k]))
              : [k];
        }
      } else if ((tok as any).array) {
        const arrNode = {
          type: "array",
          items: { type: "object", properties: {}, additionalProperties: true },
        };
        if (!node.items && !node.type) {
          Object.assign(node, arrNode);
          node = node.items;
        } else if (node.type === "array") {
          node.items ||= { type: "object", properties: {}, additionalProperties: true };
          node = node.items;
        } else {
          return;
        }
      }
    }
  }

  function typeNodeFor(t: string): any {
    switch (t) {
      case "string":
      case "number":
      case "boolean":
      case "object":
      case "array":
        return { type: t };
      default:
        return {};
    }
  }

  for (const p of Object.values(params as Record<string, any>)) {
    if (!p || typeof p !== "object") continue;
    const hasPath = typeof p.path === "string" && p.path.startsWith("$");
    if (!hasPath) continue;
    const isRequired = !!p.required && !Object.prototype.hasOwnProperty.call(p, "default");
    const tokens: Array<string | { union: string[] } | { array: true }> = [];

    try {
      const expr = p.path as string;
      // Validate JSONPath early in RFC mode
      try {
        compileJsonPath(expr);
      } catch {
        /* ignore; schema validation will catch */
      }
      let i = 1; // after $
      while (i < expr.length) {
        if (expr[i] === ".") {
          i++;
          if (expr[i] === "*") {
            i++;
            continue;
          }
          const start = i;
          while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) i++;
          const name = expr.slice(start, i);
          if (name) tokens.push(name);
          continue;
        }
        if (expr[i] === "[") {
          let j = i + 1;
          while (j < expr.length && expr[j] !== "]") j++;
          if (expr[j] !== "]") break;
          const inner = expr.slice(i + 1, j).trim();
          if (inner === "*") tokens.push({ array: true });
          else if (/^\d+$/.test(inner)) tokens.push({ array: true });
          else if (/^(['"]).*\1(\s*,\s*(['"]).*\3)*$/.test(inner)) {
            const re = /(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g;
            const names: string[] = [];
            let m: RegExpExecArray | null;
            while ((m = re.exec(inner)) !== null) names.push(m[2].replace(/\\(['"])/g, "$1"));
            if (names.length) tokens.push({ union: names });
          }
          i = j + 1;
          continue;
        }
        break;
      }
      if (tokens.length) ensurePath(tokens, String(p.type || "object"), isRequired);
    } catch {
      // ignore malformed paths
    }
  }

  if (Array.isArray(root.required) && root.required.length === 0) delete root.required;
  return root;
}
