#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio mcp — cli error precedence", () => {
  test("non-zero exit beats JSON success -> Generic(1)", async () => {
    await runInTemp("jio-cli-precedence", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "exit7.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log(JSON.stringify({ ok: true }));
process.exit(7);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "exit7" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "json" },
        },
      });
      await fsp.writeFile(path.join(tmp, "exit7.tool.json"), JSON.stringify(spec, null, 2), "utf8");
      let code = 0;
      try {
        await $({ stdio: "pipe" })`env JIO_CLI_INVOCATION=json jio io.example.exit7`;
      } catch (e: any) {
        code = e.exitCode || e.code || 1;
      }
      assert.equal(code, 1);
    });
  });
});
