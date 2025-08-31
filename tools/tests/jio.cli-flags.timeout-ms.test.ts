#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio CLI flags: timeout-ms", () => {
  test("--timeout-ms enforces termination window", async () => {
    await runInTemp("jio-cli-timeout-ms", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "hang.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
setInterval(()=>{}, 1000)
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const specPath = path.join(tmp, "hang.tool.json");
      const spec = defineToolSpec({
        tool: { name: "hang" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      let failed = false;
      const start = Date.now();
      try {
        await $({ stdio: "pipe" })`jio io.example.hang --timeout-ms 500`;
      } catch (e: any) {
        const dt = Date.now() - start;
        if (dt < 400 || dt > 8000) {
          console.error("unexpected timeout behavior, dt=", dt);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected timeout enforcement");
        process.exit(2);
      }
    });
  });
});
