#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli PR3 stdoutTransform + validation", () => {
  test("ndjson output validated and streamed", async () => {
    await runInTemp("json-cli-stdout-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // Create a tiny script that prints two lines JSON on stdout
      const toolPath = path.join(tmp, "tools", "echo-json.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
import { $ } from 'zx';
console.log('{"ok":1}');
console.log('{"ok":2}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "echo.tool.json");
      await fsp.writeFile(
        specPath,
        JSON.stringify(
          {
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
          },
          null,
          2,
        ),
        "utf8",
      );

      const out = await $({ stdio: "pipe" })`json-cli io.example.echo`;
      const lines = String(out.stdout).trim().split(/\n+/);
      if (!(lines.includes('{"ok":1}') && lines.includes('{"ok":2}'))) {
        console.error("missing echoed lines:", lines);
        process.exit(2);
      }
    });
  });

  test("json output validation error reported", async () => {
    await runInTemp("json-cli-stdout-json", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "echo-json-one.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"notOk":true}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "echo1.tool.json");
      await fsp.writeFile(
        specPath,
        JSON.stringify(
          {
            tool: {
              name: "echo1",
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
              stdoutTransform: { shell: "jq -c .", format: "json" },
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      let failed = false;
      try {
        await $({ stdio: "pipe" })`json-cli io.example.echo1`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/invalid output/i.test(err)) {
          console.error("expected validation error in stderr, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to invalid output");
        process.exit(2);
      }
    });
  });
});
