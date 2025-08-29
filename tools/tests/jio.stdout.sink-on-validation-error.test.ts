#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdout JSON validation error triggers sink and exits 65", () => {
  test("invalid JSON (schema) + onValidationFailure emits marker and exit 65", async () => {
    await runInTemp("jio-stdout-sink", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      const toolPath = path.join(tmp, "tools", "badone.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"notOk":true}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const marker = path.join(tmp, "sink.txt");
      const specPath = path.join(tmp, "badone.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "badone",
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
          onValidationFailure: { shell: `echo sink >> ${marker}` },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.badone`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/invalid output/i.test(err)) {
          console.error("expected invalid output error, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to schema error");
        process.exit(2);
      }
      const sinkTxt = await fsp.readFile(marker, "utf8").catch(() => "");
      if (!sinkTxt.includes("sink")) {
        console.error("expected sink to be invoked on validation error");
        process.exit(2);
      }
    });
  });
});
