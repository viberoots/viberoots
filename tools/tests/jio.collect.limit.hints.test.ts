#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio collect limit exceeded emits hints", () => {
  test("collect limit exceeded returns exit 78 with hints", async () => {
    await runInTemp("jio-collect-limit-hint", async (tmp, $) => {
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
              value: 'for i in $(seq 1 10); do echo "{\\"a\\":$i}"; done',
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
        })`jio io.example.emit --collect --collect-limit 100 --collect-bytes 10`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || e);
        if (!/collect limit exceeded/i.test(err)) {
          console.error("expected collect limit exceeded, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected exit 78 due to collect cap");
        process.exit(2);
      }
    });
  });
});
