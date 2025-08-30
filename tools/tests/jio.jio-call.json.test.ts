#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { jioCall } from "../dev/jio-call";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jioCall helper — JSON", () => {
  test("JSON tool returns parsed object", async () => {
    await runInTemp("jio-call-json", async (tmp, $) => {
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
console.log('{"ok":1}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const specPath = path.join(tmp, "echo.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "echo",
          outputSchema: {
            type: "object",
            properties: { ok: { type: "number" } },
            required: ["ok"],
          },
        },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const out = (await jioCall(
        "io.example.echo",
        { any: true },
        { output: "json", cwd: tmp },
      )) as any;
      if (out.ok !== 1) {
        console.error("expected ok=1, got:", out);
        process.exit(2);
      }
    });
  });
});
