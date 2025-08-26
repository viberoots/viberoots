#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../json-cli/spec";

describe("json-cli stdinTransform + input validation", () => {
  test("fails fast when invocation JSON violates inputSchema", async () => {
    await runInTemp("json-cli-stdin-invalid", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "bad.tool.json");
      const spec = defineToolSpec({
        tool: { name: "bad", inputSchema: { type: "object", required: ["need"] } },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(inv, JSON.stringify({}), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`json-cli io.example.bad --in ${inv}`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/invalid input/i.test(err)) {
          console.error("expected input validation error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to invalid input");
        process.exit(2);
      }
    });
  });

  test("stdinTransform ndjson: array to lines, command receives items", async () => {
    await runInTemp("json-cli-stdin-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // command: a script that counts lines coming in and emits JSON count
      const toolPath = path.join(tmp, "tools", "count-lines.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
import fs from 'node:fs';
let count = 0;
for await (const _ of fs.createReadStream(0, { encoding: 'utf8' })) { /* noop */ }
// Using cat to count is simpler; implement via shell below instead of TS stream
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "ndjson.tool.json");
      const spec = defineToolSpec({
        tool: { name: "ndjson" },
        command: {
          package: "io.example",
          // Count lines using wc -l; then emit JSON via jq
          exec: "bash",
          parameters: { sub: { type: "string", value: "-lc", position: 1 } },
          stdinTransform: { shell: "jq -c '.items[] | {v: .}'", format: "ndjson" },
          stdoutTransform: { shell: "awk '{print $0}' | jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      // Use a simple command that echoes stdin back as lines and then pipe through jq -c .
      // Here, we simulate by sending two items; the stdoutTransform wraps each again
      const input = JSON.stringify({ items: [1, 2, 3] });
      const out = await $({ stdin: input, stdio: "pipe" })`json-cli io.example.ndjson`;
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

  test("stdinTransform json: enforce single JSON document", async () => {
    await runInTemp("json-cli-stdin-json", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
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
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const input = JSON.stringify({ items: [1, 2, 3, 4] });
      const out = await $({ stdin: input, stdio: "pipe" })`json-cli io.example.jsondoc`;
      const lines = String(out.stdout).trim().split(/\n+/);
      if (lines.length !== 1) {
        console.error("expected single JSON line, got:", lines);
        process.exit(2);
      }
      const obj = JSON.parse(lines[0]);
      if (obj.count !== 4) {
        console.error("unexpected count:", obj);
        process.exit(2);
      }
    });
  });
});
