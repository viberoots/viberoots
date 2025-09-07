#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio mcp — cli sink gated behavior", () => {
  test("sink caps/rates respected and do not hang", async () => {
    await runInTemp("jio-cli-sink-caps", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "emit-nonjson-lines.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
for (let i=0;i<500;i++) process.stdout.write('not-json-'+i+'\\n');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "spam" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
          onValidationFailure: { shell: "cat >/dev/null" },
        },
      });
      await fsp.writeFile(path.join(tmp, "spam.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      const out = await $({
        stdio: "pipe",
      })`env JIO_CLI_INVOCATION=ndjson jio io.example.spam --sink-max-rate-per-sec 5 --sink-max-items 10 --sink-max-bytes 1024 --sink-write-timeout-ms 10 --sink-close-timeout-ms 50`;
      const err = String(out.stderr || out.stdout || "");
      assert.match(err, /sink limits reached/i);
    });
  });
});
