#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio NDJSON trailing line cap", () => {
  test("oversized trailing line without newline triggers trailing message and exit 78", async () => {
    await runInTemp("jio-ndjson-trailing", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "trailing.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
// Emit a small valid line, then a large trailing chunk without newline
console.log('{"ok":"small"}');
const s = 'x'.repeat(200000);
process.stdout.write('{"ok":"' + s + '"}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "trailing.tool.json");
      const spec = defineToolSpec({
        tool: { name: "trailing" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.trailing --max-ndjson-line-bytes 65536`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (
          !/(ndjson line bytes limit exceeded \(trailing\)|ndjson line bytes limit exceeded \(stream\))/i.test(
            err,
          )
        ) {
          console.error("expected trailing or stream ndjson bytes exceeded message, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to trailing ndjson line cap");
        process.exit(2);
      }
    });
  });
});
