#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio CLI schema flags — input", () => {
  test("--input-schema prints explicit or inferred schema", async () => {
    await runInTemp("cli-input-schema", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "tool.tool.json");
      const spec = defineToolSpec({
        tool: { name: "t", inputSchema: { type: "object", properties: { a: { type: "string" } } } },
        command: { package: "io.example", exec: "bash", parameters: {} },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec), "utf8");
      const res = await $({ cwd: tmp, stdio: "pipe" })`tools/bin/jio io.example.t --input-schema`;
      const obj = JSON.parse(String(res.stdout || "{}"));
      assert.equal(obj?.type, "object");
      assert.ok(obj?.properties?.a);
    });
  });
});
