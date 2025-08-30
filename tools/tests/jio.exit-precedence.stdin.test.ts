#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio exit precedence — stdinTransform", () => {
  test("stdinTransform parse error takes precedence over exec/stdout", async () => {
    await runInTemp("jio-exit-stdin", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "badstdin.tool.json");
      const spec = defineToolSpec({
        tool: { name: "badstdin" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: { sub: { type: "string", value: "-lc", position: 1 } },
          stdinTransform: { shell: "printf 'not-json\n'", format: "ndjson" },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdin: "", stdio: "pipe" })`jio io.example.badstdin`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/stage failed: stdinTransform code=65/.test(err)) {
          console.error("expected stdinTransform failure with code 65, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to stdin parse error");
        process.exit(2);
      }
    });
  });
});
