#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio argv bytes cap", () => {
  test("--max-argv-bytes triggers exit 78 with message", async () => {
    await runInTemp("jio-argv-bytes", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "argbytes" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "true", position: 2 },
            many: {
              type: "array",
              flag: true,
              flagName: "-n",
              collectionStyle: "repeatFlag",
              path: "$.many",
              required: true,
            },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(dir, "argbytes.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      // Construct many long args
      const arr = Array.from({ length: 200 }, (_, i) => "X".repeat(200));
      const inPath = path.join(tmp, "in.json");
      await fsp.writeFile(inPath, JSON.stringify({ many: arr }), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.argbytes --in=${inPath} --max-argv-bytes 10000`;
      } catch (e: any) {
        const err = String(e?.stderr || e);
        if (!/argv bytes limit exceeded/i.test(err)) {
          console.error("expected argv bytes limit exceeded, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to argv bytes cap");
        process.exit(2);
      }
    });
  });
});
