#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

// Covers getSchemaAtPath bracket notation ['prop'] filtering of kv keys
describe("jio JSONPath bracket notation in schema path", () => {
  test("kv keys not allowed are rejected via schema at ['sub']", async () => {
    await runInTemp("jio-jsonpath-brackets", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: {
          name: "kv-guard",
          inputSchema: {
            type: "object",
            properties: {
              sub: {
                type: "object",
                properties: { allow: { type: "string" } },
              },
            },
          },
        },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "true", position: 2 },
            opts: { type: "object", collectionStyle: "kv", flag: true, path: "$.['sub']" },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(dir, "kv-guard.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify({ sub: { allow: "ok", deny: "no" } }), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.kv-guard --in=${inPath}`;
      } catch (e: any) {
        const err = String(e?.stderr || e);
        if (!/kv keys not allowed/i.test(err)) {
          console.error("expected kv keys not allowed error, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected kv schema enforcement failure");
        process.exit(2);
      }
    });
  });
});
