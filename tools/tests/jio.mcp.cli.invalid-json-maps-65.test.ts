#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio mcp — cli invalid JSON maps to 65", () => {
  test("invalid JSON with exit 0 -> 65", async () => {
    await runInTemp("jio-cli-invalid-json-65", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "badjson.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
process.stdout.write('not-json');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "badjson" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(
        path.join(tmp, "badjson.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let code = 0;
      try {
        await $({ stdio: "pipe" })`env JIO_CLI_INVOCATION=json jio io.example.badjson`;
      } catch (e: any) {
        code = e.exitCode || e.code || 0;
      }
      assert.equal(code, 65);
    });
  });
});
