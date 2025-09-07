#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio mcp — cli timeout maps to 124", () => {
  test("timeout -> 124", async () => {
    await runInTemp("jio-cli-timeout-124", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "sleep.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
await new Promise(r => setTimeout(r, 2000));
console.log('{}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "sleep" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(tmp, "sleep.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let code = 0;
      try {
        await $({
          stdio: "pipe",
        })`env JIO_CLI_INVOCATION=json JIO_TIMEOUT_MS=200 jio io.example.sleep`;
      } catch (e: any) {
        code = e.exitCode || e.code || 0;
      }
      assert.equal(code, 124);
    });
  });
});
