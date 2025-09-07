#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio mcp — cli json gated behavior", () => {
  test("stdout JSON cap triggers non-zero exit with message", async () => {
    await runInTemp("jio-cli-json-cap-gated", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "big-json.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
const chunk = 'x'.repeat(50000);
process.stdout.write('{"x":"' + chunk + chunk + '"}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "bigjson" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "bigjson.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let failed = false;
      try {
        await $({
          stdio: "pipe",
        })`env JIO_CLI_INVOCATION=json jio io.example.bigjson --max-stdout-json-bytes 1000`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        assert.match(err, /stdout JSON bytes limit exceeded/i);
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to stdout JSON bytes cap");
        process.exit(2);
      }
    });
  });

  test("invalid JSON yields InvalidJSON error", async () => {
    await runInTemp("jio-cli-json-invalid-gated", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "emit-junk.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
process.stdout.write('junk');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "bad" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(tmp, "bad.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`env JIO_CLI_INVOCATION=json jio io.example.bad`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        assert.match(err, /invalid JSON output|invalid JSON document/i);
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit on invalid JSON");
        process.exit(2);
      }
    });
  });

  test("exit non-zero takes precedence over valid JSON", async () => {
    await runInTemp("jio-cli-json-exit-precedence-gated", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "emit-json-exit7.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
process.stdout.write('{"ok":true}');
process.exit(7);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "badexit" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "badexit.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let err = "";
      let out = "";
      let code = 0;
      try {
        const r = await $({ stdio: "pipe" })`env JIO_CLI_INVOCATION=json jio io.example.badexit`;
        out = String(r.stdout || "");
      } catch (e: any) {
        err = String(e?.stderr || e?.stdout || "");
        code = 1;
      }
      assert.notEqual(code, 0, "expected non-zero exit precedence");
      // We don't require a specific stderr phrase; debug lines are acceptable
      // Output may or may not be present depending on buffering
      assert.ok(out === "" || /\{\s*"ok"\s*:\s*true\s*\}/.test(out));
    });
  });
});
