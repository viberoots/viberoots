#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../json-cli/spec";

describe("json-cli exit precedence and standardized codes", () => {
  test("stdinTransform parse error takes precedence over exec/stdout", async () => {
    await runInTemp("json-cli-exit-stdin", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const specPath = path.join(tmp, "badstdin.tool.json");
      const spec = defineToolSpec({
        tool: { name: "badstdin" },
        command: {
          package: "io.example",
          exec: "bash",
          parameters: { sub: { type: "string", value: "-lc", position: 1 } },
          // Emit non-JSON text to force stdin parse error, then cat it to exec
          stdinTransform: { shell: "printf 'not-json\n'", format: "ndjson" },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdin: "", stdio: "pipe" })`json-cli io.example.badstdin`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/stage failed: stdinTransform code=65/.test(err)) {
          console.error("expected stdinTransform failure with code 65, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to stdin parse error");
        process.exit(2);
      }
    });
  });

  test("stdoutTransform parse error wins over zero-exit exec", async () => {
    await runInTemp("json-cli-exit-stdout", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const tool = path.join(tmp, "tools", "emit-bad.ts");
      await fsp.mkdir(path.dirname(tool), { recursive: true });
      await fsp.writeFile(
        tool,
        `#!/usr/bin/env zx-wrapper
console.log('not-json');
`,
        "utf8",
      );
      await $`chmod +x ${tool}`;
      const specPath = path.join(tmp, "badstdout.tool.json");
      const spec = defineToolSpec({
        tool: { name: "badstdout" },
        command: {
          package: "io.example",
          exec: tool,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      try {
        await $({ stdio: "pipe" })`json-cli io.example.badstdout`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/stage failed: stdoutTransform code=65/.test(err)) {
          console.error("expected stdoutTransform failure with code 65, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure due to stdout parse error");
        process.exit(2);
      }
    });
  });
});
