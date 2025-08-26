#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../json-cli/spec";
import { runInTemp } from "./lib/test-helpers";

describe("json-cli JSON/NDJSON tolerance (CRLF, blank lines, BOM)", () => {
  test("NDJSON: mixed CRLF/LF and blank lines", async () => {
    await runInTemp("json-cli-tol-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "echo.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
process.stdin.pipe(process.stdout);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "tol1.tool.json");
      const spec = defineToolSpec({
        tool: { name: "tol1" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const input = '{"a":1}\r\n\n{"b":2}\n';
      const out = await $({ stdin: input, stdio: "pipe" })`json-cli io.example.tol1`;
      const lines = String(out.stdout).trim().split(/\n+/);
      if (!(lines.includes('{"a":1}') && lines.includes('{"b":2}'))) {
        console.error("did not tolerate CRLF/blank lines:", lines);
        process.exit(2);
      }
    });
  });

  test("BOM is ignored for NDJSON first line and JSON document", async () => {
    await runInTemp("json-cli-tol-bom", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "echo.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
process.stdin.pipe(process.stdout);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      // NDJSON case
      const specNd = defineToolSpec({
        tool: { name: "tol2" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "tol2.tool.json"),
        JSON.stringify(specNd, null, 2),
        "utf8",
      );
      const bom = "\ufeff";
      const inputNd = bom + '{"x":1}\n{"y":2}\n';
      const outNd = await $({ stdin: inputNd, stdio: "pipe" })`json-cli io.example.tol2`;
      const linesNd = String(outNd.stdout).trim().split(/\n+/);
      if (!(linesNd[0] === '{"x":1}' && linesNd.includes('{"y":2}'))) {
        console.error("BOM not ignored on first NDJSON line:", linesNd);
        process.exit(2);
      }

      // JSON document case
      const specJs = defineToolSpec({
        tool: { name: "tol3" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "tol3.tool.json"),
        JSON.stringify(specJs, null, 2),
        "utf8",
      );
      const inputJson = bom + '{"ok":true}';
      const outJs = await $({ stdin: inputJson, stdio: "pipe" })`json-cli io.example.tol3`;
      if (String(outJs.stdout).trim() !== '{"ok":true}') {
        console.error("BOM not ignored for JSON doc:", String(outJs.stdout));
        process.exit(2);
      }
    });
  });
});
