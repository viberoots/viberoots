#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { jioCall } from "../dev/jio-call";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jioCall helper — NDJSON", () => {
  test("NDJSON tool returns collected array", async () => {
    await runInTemp("jio-call-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "echo-lines.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"x":1}');
console.log('{"x":2}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const specPath = path.join(tmp, "lines.tool.json");
      const spec = defineToolSpec({
        tool: { name: "lines", outputSchema: { type: "object" } },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const arr = (await jioCall("io.example.lines", {}, { output: "ndjson", cwd: tmp })) as any[];
      if (!Array.isArray(arr) || arr.length !== 2 || arr[0].x !== 1 || arr[1].x !== 2) {
        console.error("expected [ {x:1}, {x:2} ], got:", arr);
        process.exit(2);
      }
    });
  });
});
