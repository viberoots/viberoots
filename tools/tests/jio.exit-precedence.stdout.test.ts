#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio exit precedence — stdoutTransform", () => {
  test("stdoutTransform parse error wins over zero-exit exec", async () => {
    await runInTemp("jio-exit-stdout", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
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
        await $({ stdio: "pipe" })`jio io.example.badstdout`;
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
