#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdout JSON bytes cap (chunked)", () => {
  test("oversized JSON triggers exit 78 with message", async () => {
    await runInTemp("jio-stdout-json-cap2", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "chunk-json.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
const chunk = 'x'.repeat(50000);
process.stdout.write('{"x":"' + chunk);
setTimeout(() => process.stdout.write(chunk + '"}'), 20);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "chunkjson.tool.json");
      const spec = defineToolSpec({
        tool: { name: "chunkjson" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.chunkjson --max-stdout-json-bytes 60000`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/stdout JSON bytes limit exceeded/i.test(err)) {
          console.error("expected stdout JSON bytes exceeded message, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to stdout JSON bytes cap");
        process.exit(2);
      }
    });
  });
});
