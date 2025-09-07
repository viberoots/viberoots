#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio mcp — cli stdin gated behavior", () => {
  test("json stdin: single JSON doc required; invalid -> message", async () => {
    await runInTemp("jio-cli-stdin-json-invalid", async (tmp, $) => {
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
let data = '';
for await (const c of process.stdin) data += Buffer.from(c).toString('utf8');
process.stdout.write(data);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "echojson" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdinTransform: { shell: "cat", format: "json" },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "echojson.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let failed = false;
      try {
        await $({
          stdio: "pipe",
        })`bash --noprofile --norc -lc ${`printf junk | env JIO_CLI_INVOCATION=stdin jio io.example.echojson`}`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        assert.match(err, /stdinTransform did not emit valid JSON/i);
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit on invalid JSON stdin");
        process.exit(2);
      }
    });
  });

  test("json stdin: bytes cap", async () => {
    await runInTemp("jio-cli-stdin-json-cap", async (tmp, $) => {
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
let data = '';
for await (const c of process.stdin) data += Buffer.from(c).toString('utf8');
process.stdout.write(data);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "echojson" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdinTransform: { shell: "cat", format: "json" },
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "echojson.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      const big = "{" + `"x":"${"x".repeat(5000)}"` + "}";
      let failed = false;
      try {
        await $({
          stdio: "pipe",
        })`bash --noprofile --norc -lc ${`printf %s '${big}' | env JIO_CLI_INVOCATION=stdin jio io.example.echojson --max-stdin-bytes 100`}`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        assert.match(err, /stdin bytes limit exceeded \(json\)/i);
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit on stdin json cap");
        process.exit(2);
      }
    });
  });

  test("ndjson stdin: invalid line triggers message", async () => {
    await runInTemp("jio-cli-stdin-ndjson-invalid", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "cat-lines.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
for await (const c of process.stdin) process.stdout.write(Buffer.from(c).toString('utf8'));
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "catlines" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdinTransform: { shell: "cat", format: "ndjson" },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "catlines.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let failed = false;
      try {
        await $({
          stdio: "pipe",
        })`bash --noprofile --norc -lc ${`printf 'junk\n' | env JIO_CLI_INVOCATION=stdin jio io.example.catlines`}`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        assert.match(err, /stdinTransform emitted non-JSON line/i);
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit on invalid ndjson line");
        process.exit(2);
      }
    });
  });
});
