#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio mcp — cli config error maps to 78", () => {
  test("missing exec -> 78", async () => {
    await runInTemp("jio-cli-config-78", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "badcfg" },
        command: {
          package: "io.example",
          // exec intentionally omitted
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "badcfg.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let code = 0;
      try {
        await $({ stdio: "pipe" })`env JIO_CLI_INVOCATION=json jio io.example.badcfg`;
      } catch (e: any) {
        code = e.exitCode || e.code || 0;
      }
      assert.equal(code, 78);
    });
  });
});
