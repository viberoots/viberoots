#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio CLI schema flags", () => {
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

  test("--output-schema prints explicit schema, errors if absent", async () => {
    await runInTemp("cli-output-schema", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "tool.tool.json");
      const spec = defineToolSpec({
        tool: { name: "t", outputSchema: { type: "object" } },
        command: { package: "io.example", exec: "bash", parameters: {} },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec), "utf8");
      const res = await $({ cwd: tmp, stdio: "pipe" })`tools/bin/jio io.example.t --output-schema`;
      const obj = JSON.parse(String(res.stdout || "{}"));
      assert.equal(obj?.type, "object");

      const spec2 = defineToolSpec({
        tool: { name: "t2" },
        command: { package: "io.example", exec: "bash", parameters: {} },
      });
      await fsp.writeFile(path.join(tmp, "tool2.tool.json"), JSON.stringify(spec2), "utf8");
      let failed = false;
      try {
        await $({ cwd: tmp, stdio: "pipe" })`tools/bin/jio io.example.t2 --output-schema`;
      } catch (e: any) {
        failed = true;
      }
      assert.ok(failed, "expected non-zero exit when outputSchema missing");
    });
  });

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
