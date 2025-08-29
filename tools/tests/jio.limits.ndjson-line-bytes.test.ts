#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio NDJSON line-bytes limits", () => {
  test("streaming line over maxNdjsonLineBytes triggers exit 78", async () => {
    await runInTemp("jio-ndjson-cap", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "big-line.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      // Emit one very large JSON line (no newline yet), then a newline later
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
const s = 'x'.repeat(200000); // 200KB line
process.stdout.write('{"ok":"' + s + '"}');
setTimeout(() => process.stdout.write('\\n'), 50);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "bigline.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "bigline",
          outputSchema: {
            type: "object",
            properties: { ok: { type: "string" } },
            required: ["ok"],
          },
        },
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
        await $({ stdio: "pipe" })`jio io.example.bigline --max-ndjson-line-bytes 65536`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/ndjson line bytes limit exceeded/i.test(err)) {
          console.error("expected ndjson line bytes exceeded message, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to ndjson line bytes cap");
        process.exit(2);
      }
    });
  });
});
