#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio kv keys subset of inputSchema.properties", () => {
  test("invalid kv keys are rejected with exit 78", async () => {
    await runInTemp("jio-kv-keys", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: {
          name: "kv",
          inputSchema: {
            type: "object",
            properties: {
              flags: {
                type: "object",
                additionalProperties: true,
                properties: { a: { type: "string" } },
              },
            },
            additionalProperties: false,
          },
        },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "true", position: 2 },
            flags: { type: "object", flag: true, collectionStyle: "kv", path: "$.flags" },
          },
          stdoutTransform: { shell: "echo '{}'", format: "json" },
        },
      });
      await fsp.writeFile(path.join(dir, "kv.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify({ flags: { bad: "x" } }), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.kv --in=${inPath}`;
      } catch (e: any) {
        const err = String(e?.stderr || e);
        if (!/kv keys not allowed|invalid input/i.test(err)) {
          console.error("expected kv keys or schema error, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to kv keys subset");
        process.exit(2);
      }
    });
  });
});
