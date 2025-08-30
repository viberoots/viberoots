#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio CLI schema flags — both", () => {
  test("combined --input-schema and --output-schema prints combined object when output exists", async () => {
    await runInTemp("cli-both-schema", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "tool.tool.json");
      const spec = defineToolSpec({
        tool: { name: "t", outputSchema: { type: "object" } },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: { a: { path: "$.a", type: "string", required: true } },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec), "utf8");
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
      })`tools/bin/jio io.example.t --input-schema --output-schema`;
      const obj = JSON.parse(String(res.stdout || "{}"));
      assert.ok(obj?.inputSchema);
      assert.ok(obj?.outputSchema);
    });
  });
});
