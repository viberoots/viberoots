#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio mcp — cli progress visibility and cancel", () => {
  test("progress lines appear when gated", async () => {
    await runInTemp("jio-cli-progress-visible", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "progress.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
let i = 0;
const it = setInterval(() => {
  i++;
  process.stderr.write('progress '+i+'\\n');
  if (i >= 3) { clearInterval(it); process.stdout.write('{"ok":true}'); }
}, 200);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "progress" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(tmp, "progress.tool.json"), JSON.stringify(spec, null, 2));
      const out = await $({
        stdio: "pipe",
      })`env JIO_CLI_INVOCATION=json JIO_CLI_PROGRESS=1 jio io.example.progress`;
      const stderr = String(out.stderr || "");
      // For now, surface tool-provided progress lines on stderr
      assert.match(stderr, /progress 1/);
    });
  });

  test("timeout mid-stream returns 124", async () => {
    await runInTemp("jio-cli-cancel-midstream", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "slow-ndjson.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
let i = 0;
const it = setInterval(() => {
  i++;
  process.stdout.write(JSON.stringify({ i })+'\\n');
}, 150);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "slow" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(path.join(tmp, "slow.tool.json"), JSON.stringify(spec, null, 2));
      let threw = false;
      try {
        const p = $({
          stdio: "pipe",
        })`env JIO_CLI_INVOCATION=ndjson JIO_TIMEOUT_MS=500 jio io.example.slow --collect`;
        await p;
      } catch (e: any) {
        threw = true;
        const code = Number(e?.exitCode ?? e?.code ?? 0);
        if (code !== 124) {
          console.error("expected exit 124 on timeout, got", code);
          process.exit(3);
        }
      }
      if (!threw) {
        console.error("expected non-zero exit due to timeout");
        process.exit(2);
      }
    });
  });
});
