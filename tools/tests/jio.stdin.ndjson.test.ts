#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdinTransform + input validation — ndjson", () => {
  test("stdinTransform ndjson: array to lines, command receives items", async () => {
    await runInTemp("jio-stdin-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const specPath = path.join(tmp, "ndjson.tool.json");
      const spec = defineToolSpec({
        tool: { name: "ndjson" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: { sub: { type: "string", value: "-lc", position: 1 } },
          stdinTransform: { shell: "jq -c '.items[] | {v: .}'", format: "ndjson" },
          stdoutTransform: { shell: "cat", format: "ndjson" },
          env: { JIO_DEBUG: "1", JIO_DEBUG_FILE: path.join(tmp, "debug.log") },
          timeoutMs: 4000,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const input = JSON.stringify({ items: [1, 2, 3] });
      const inFile = path.join(tmp, "stdin.ndjson.json");
      await fsp.writeFile(inFile, input, "utf8");
      const out = await $({
        stdio: "pipe",
        env: {
          ...process.env,
          JIO_SKIP_DIRENV: "1",
          WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || process.cwd(),
        },
      })`bash --noprofile --norc -c ${`cat '${inFile}' | jio io.example.ndjson`}`;
      const lines = String(out.stdout).trim().split(/\n+/);
      if (lines.length < 3) {
        console.error("expected at least 3 lines, got:", lines);
        process.exit(2);
      }
      try {
        for (const s of lines) JSON.parse(s);
      } catch {
        console.error("lines not valid JSON:", lines);
        process.exit(2);
      }
    });
  });
});
