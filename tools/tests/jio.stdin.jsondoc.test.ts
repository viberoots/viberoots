#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdinTransform + input validation — json doc", () => {
  test("stdinTransform json: enforce single JSON document", async () => {
    await runInTemp("jio-stdin-json", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const specPath = path.join(tmp, "jsondoc.tool.json");
      const spec = defineToolSpec({
        tool: { name: "jsondoc" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: { sub: { type: "string", value: "-lc", position: 1 } },
          stdinTransform: { shell: "jq '{count: (.items | length)}'", format: "json" },
          stdoutTransform: { shell: "cat", format: "json" },
          env: {},
          timeoutMs: 10000,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const input = JSON.stringify({ items: [1, 2, 3, 4] });
      const inFile = path.join(tmp, "stdin.jsondoc.json");
      await fsp.writeFile(inFile, input, "utf8");
      const out = await $({
        stdio: "pipe",
        env: {
          ...process.env,
          JIO_SKIP_DIRENV: "1",
          WORKSPACE_ROOT: process.env.WORKSPACE_ROOT || process.cwd(),
        },
      })`bash --noprofile --norc -c ${`cat '${inFile}' | jio io.example.jsondoc`}`;
      const obj = JSON.parse(String(out.stdout));
      if (obj.count !== 4) {
        console.error("unexpected count:", obj);
        process.exit(2);
      }
    });
  });
});
