#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdoutTransform + validation — ndjson", () => {
  test("ndjson output validated and streamed", async () => {
    await runInTemp("jio-stdout-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "echo-json.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"ok":1}');
console.log('{"ok":2}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "echo.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "echo",
          outputSchema: {
            type: "object",
            properties: { ok: { type: "number" } },
            required: ["ok"],
          },
        },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const out = await $({ stdio: "pipe" })`jio io.example.echo`;
      const lines = String(out.stdout).trim().split(/\n+/);
      if (!(lines.includes('{"ok":1}') && lines.includes('{"ok":2}'))) {
        console.error("missing echoed lines:", lines);
        process.exit(2);
      }
    });
  });
});
