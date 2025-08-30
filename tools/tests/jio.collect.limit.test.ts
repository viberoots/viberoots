#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio --collect — collect-limit", () => {
  test("collect limit exceeded fails", async () => {
    await runInTemp("jio-collect-limit", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "many" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            script: {
              type: "string",
              value: "for i in $(seq 1 5); do echo '{\"i\":'$i'}'; done",
              position: 2,
            },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "many.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.many --collect --collect-limit 3`;
      } catch (e: any) {
        const stderrTxt = String(e?.stderr || "");
        const stdoutTxt = String(e?.stdout || "");
        if (!/collect-limit/i.test(stderrTxt)) {
          console.error("expected collect-limit error, got:\n" + stderrTxt);
          process.exit(2);
        }
        try {
          const arr = JSON.parse(stdoutTxt.trim());
          if (!Array.isArray(arr) || arr.length !== 3) {
            console.error("expected output array of length 3, got: " + stdoutTxt);
            process.exit(2);
          }
        } catch {
          console.error("expected valid JSON array on stdout, got:\n" + stdoutTxt);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to collect limit");
        process.exit(2);
      }
      let failedEq = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.many --collect --collect-limit=2`;
      } catch (e: any) {
        const stderrTxt = String(e?.stderr || "");
        const stdoutTxt = String(e?.stdout || "");
        if (!/collect-limit/i.test(stderrTxt)) {
          console.error("expected collect-limit error (eq form), got:\n" + stderrTxt);
          process.exit(2);
        }
        try {
          const arr = JSON.parse(stdoutTxt.trim());
          if (!Array.isArray(arr) || arr.length !== 2) {
            console.error("expected output array of length 2, got: " + stdoutTxt);
            process.exit(2);
          }
        } catch {
          console.error("expected valid JSON array on stdout (eq form), got:\n" + stdoutTxt);
          process.exit(2);
        }
        failedEq = true;
      }
      if (!failedEq) {
        console.error("expected failure due to collect limit (= form)");
        process.exit(2);
      }
    });
  });
});
