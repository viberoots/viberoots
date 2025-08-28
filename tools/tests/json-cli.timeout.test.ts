#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../json-cli/spec";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli timeout and two-phase shutdown", () => {
  test("times out long-running command and prints timeout note", async () => {
    await runInTemp("json-cli-timeout", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "sleep.tool.json");
      const spec = defineToolSpec({
        tool: { name: "sleep" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "sleep 30", position: 2 },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
          timeoutMs: 500,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        // Run the tool; it embeds a long sleep via spec parameters
        await $({ stdio: "pipe" })`json-cli io.example.sleep`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/timeout — sent SIGTERM/i.test(err)) {
          console.error("expected timeout note in stderr, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected timeout to cause non-zero exit");
        process.exit(2);
      }
    });
  });
});
