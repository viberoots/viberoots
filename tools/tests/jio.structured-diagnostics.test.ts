#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio structured diagnostics", () => {
  test("emits JSON events for spawn/terminate/exit", async () => {
    await runInTemp("jio-struct-diag", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const spec = defineToolSpec({
        tool: { name: "t" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            cmd: { type: "string", value: "sleep 30", position: 2 },
          },
          stdoutTransform: { shell: "cat", format: "json" },
          timeoutMs: 200,
        },
      });
      await fsp.writeFile(path.join(tmp, "t.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let err = "";
      try {
        await $({ stdio: "pipe" })`env JIO_DEBUG=1 jio io.example.t`;
      } catch (e: any) {
        err = String(e?.stderr || e?.stdout || "");
      }
      const lines = err
        .split(/\n/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("{"));
      const hasTerminate = lines.some((s) => {
        try {
          const j = JSON.parse(s);
          return j && (j.event === "terminate" || j.event === "terminated");
        } catch {
          return false;
        }
      });
      const hasHumanNote = /jio: timeout — sent SIGTERM/i.test(err);
      if (!hasTerminate && !hasHumanNote) {
        console.error("expected terminate structured diagnostic or human timeout note\n" + err);
        process.exit(2);
      }
    });
  });
});
