#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdinTransform + input validation — invalid input", () => {
  test("fails fast when invocation JSON violates inputSchema", async () => {
    await runInTemp("jio-stdin-invalid", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "bad.tool.json");
      const spec = defineToolSpec({
        tool: { name: "bad", inputSchema: { type: "object", required: ["need"] } },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {},
          env: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(inv, JSON.stringify({}), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.bad --in ${inv}`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/invalid input/i.test(err)) {
          console.error("expected input validation error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to invalid input");
        process.exit(2);
      }
    });
  });
});
