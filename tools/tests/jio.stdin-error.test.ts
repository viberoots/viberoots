#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdin error path (no unhandled errors)", () => {
  test("early stdin close does not crash and exits cleanly", async () => {
    await runInTemp("jio-stdin-error", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "echo-bytes.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
let total = 0;
for await (const chunk of process.stdin) total += Buffer.from(chunk).length;
console.log(JSON.stringify({ total }));
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const spec = defineToolSpec({
        tool: { name: "echo", outputSchema: { type: "object" } },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "json" },
        },
      });
      await fsp.writeFile(path.join(tmp, "echo.tool.json"), JSON.stringify(spec, null, 2), "utf8");

      // Simulate early stdin close: feed some data then close pipe
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
      })`bash --noprofile --norc -c ${`(printf 'hello'; sleep 0.01) | jio io.example.echo`}`;
      const code = Number((res as any)?.exitCode ?? 0);
      if (code !== 0) {
        console.error("expected clean exit on early stdin close, got:", code);
        process.exit(2);
      }
    });
  });
});
