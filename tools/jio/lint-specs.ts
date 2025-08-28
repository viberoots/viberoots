#!/usr/bin/env zx-wrapper
import Ajv from "ajv";
import fg from "fast-glob";
import * as fsp from "node:fs/promises";
import path from "node:path";

const FORMAL_SCHEMA: any = {
  type: "object",
  required: ["specVersion", "tool", "command"],
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
      required: ["package", "exec", "parameters", "stdoutTransform"],
      properties: {
        package: { type: "string" },
        exec: { type: "string" },
        workingDir: { type: "string" },
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
                  path: { type: "string" },
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
                  booleanStyle: { type: "string", enum: ["presence", "equals"] },
                  collectionStyle: {
                    type: "string",
                    enum: ["repeatArg", "repeatFlag", "csv", "kv", "separate"],
                  },
                  csvSeparator: { type: "string", maxLength: 1 },
                },
                oneOf: [{ required: ["path", "type"] }, { required: ["value", "type"] }],
              },
              {
                if: { properties: { flag: { const: true } } },
                then: { required: ["flagName"] },
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
        stdoutTransform: {
          type: "object",
          required: ["shell", "format"],
          properties: {
            shell: { type: "string" },
            format: { type: "string", enum: ["ndjson", "json"] },
          },
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
    jsonPathDialect: { type: "string", const: "jsonpath-plus@8" },
    schemaDialect: { type: "string", const: "https://json-schema.org/draft/2020-12/schema" },
  },
  additionalProperties: false,
};

async function main() {
  const root = process.cwd();
  const patterns = ["**/*.tool.json"];
  const ignore = ["node_modules/**", ".git/**", "buck-out/**", "coverage/**", "dist/**"];
  const files = await fg(patterns, { cwd: root, ignore, onlyFiles: true, dot: false });
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(FORMAL_SCHEMA);
  let bad = 0;
  for (const rel of files) {
    const p = path.join(root, rel);
    try {
      const txt = await fsp.readFile(p, "utf8");
      const obj = JSON.parse(txt);
      const ok = validate(obj);
      if (!ok) {
        bad++;
        console.error(`invalid spec: ${p}`);
        console.error(JSON.stringify(validate.errors?.[0] || {}, null, 2));
      }
    } catch (e: any) {
      bad++;
      console.error(`unreadable spec: ${p}: ${String(e?.message || e)}`);
    }
  }
  if (bad > 0) {
    console.error(`jio: spec lint failed: ${bad} invalid/unreadable spec(s)`);
    process.exit(78);
  } else {
    console.log("jio: all specs valid");
  }
}

await main();
