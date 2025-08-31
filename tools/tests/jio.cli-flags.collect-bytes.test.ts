#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio CLI flags: collect-bytes", () => {
  test("--collect-bytes caps array aggregation bytes", async () => {
    await runInTemp("jio-cli-collect-bytes", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "emit" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: {
              type: "string",
              value: 'for i in $(seq 1 5); do echo "{\\"a\\":$i}"; done',
              position: 2,
            },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "emit.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({
          stdio: "pipe",
        })`jio io.example.emit --collect --collect-bytes 5 --collect-limit 1000`;
      } catch (e: any) {
        const stderr = String(e?.stderr || e?.stdout || e || "");
        if (!/collect limit exceeded/i.test(stderr)) {
          console.error("expected collect limit exceeded due to bytes cap, got:\n" + stderr);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to collect-bytes cap");
        process.exit(2);
      }
    });
  });
});
