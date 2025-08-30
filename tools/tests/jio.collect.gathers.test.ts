#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio --collect — gather", () => {
  test("collect gathers ndjson items into one array", async () => {
    await runInTemp("jio-collect", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const spec = defineToolSpec({
        tool: { name: "emit3" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {
            sub: { type: "string", value: "-lc", position: 1 },
            script: {
              type: "string",
              value: "printf '%s\n' '{\"i\":1}' '{\"i\":2}' '{\"i\":3}'",
              position: 2,
            },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(dir, "emit3.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.emit3 --collect`;
      const s = String(out.stdout).trim();
      const arr = JSON.parse(s);
      if (!Array.isArray(arr) || arr.length !== 3) {
        console.error("expected array of 3");
        process.exit(2);
      }
    });
  });
});
