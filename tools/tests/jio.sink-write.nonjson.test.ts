#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

// Verifies sink receives objects when stdinTransform emits non-JSON (runner writes reason stdout)
describe("jio sink write on non-JSON stdinTransform output", () => {
  test("emits sink writes when transform outputs invalid JSON", async () => {
    await runInTemp("jio-sink-nonjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const marker = path.join(tmp, "sink.jsonl");
      const spec = defineToolSpec({
        tool: { name: "badstdin" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "echo ok", position: 2 },
          },
          stdinTransform: { shell: "echo not-json", format: "json" },
          stdoutTransform: { shell: "cat", format: "ndjson" },
          onValidationFailure: { shell: `cat >> ${marker}` },
        },
      });
      await fsp.writeFile(
        path.join(dir, "badstdin.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.badstdin`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/stdinTransform did not emit valid JSON/i.test(err)) {
          console.error("expected stdinTransform non-JSON error, got:\n" + err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to non-JSON stdinTransform");
        process.exit(2);
      }
      const sinkTxt = await fsp.readFile(marker, "utf8").catch(() => "");
      if (!sinkTxt) {
        console.error("expected sink to receive at least one object");
        process.exit(2);
      }
    });
  });
});
