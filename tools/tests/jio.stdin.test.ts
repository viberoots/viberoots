#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdinTransform + input validation", () => {
  test("fails fast when invocation JSON violates inputSchema", async () => {
    await runInTemp("jio-stdin-invalid", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
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
          env: {},
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const inv = path.join(tmp, "inv.json");
      await fsp.writeFile(inv, JSON.stringify({}), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.bad --in ${inv}`;
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
    await runInTemp("jio-stdin-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
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
          // Use cat to minimize buffering in the test harness
          stdoutTransform: { shell: "cat", format: "ndjson" },
          env: { JIO_DEBUG: "1", JIO_DEBUG_FILE: path.join(tmp, "debug.log") },
          timeoutMs: 4000,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      // (removed breadcrumb probe)

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
          // Use cat to minimize buffering in the test harness
          stdoutTransform: { shell: "cat", format: "json" },
          env: {},
          timeoutMs: 10000,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      // (removed breadcrumb probe)

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
