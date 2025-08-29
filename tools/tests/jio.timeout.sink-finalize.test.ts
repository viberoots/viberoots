#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio timeout finalizes failure sink", () => {
  test("timeout  triggers sink finalize and exit 124", async () => {
    await runInTemp("jio-timeout-sink", async (tmp, $) => {
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
// Simulate a hanging process that ignores SIGTERM
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const sinkFile = path.join(tmp, "sink.jsonl");
      const specPath = path.join(tmp, "hang.tool.json");
      const spec = defineToolSpec({
        tool: { name: "hang" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
          onValidationFailure: { shell: `echo '{"timeout":true}' >> ${sinkFile}` },
          timeoutMs: 200,
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.hang`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/timeout/i.test(err)) {
          console.error("expected timeout message, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to timeout");
        process.exit(2);
      }
      const sinkTxt = await fsp.readFile(sinkFile, "utf8").catch(() => "");
      if (!sinkTxt.includes("timeout")) {
        console.error("expected sink to be finalized and contain a marker");
        process.exit(2);
      }
    });
  });
});
