#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio onValidationFailure for NDJSON tolerance", () => {
  test("invalid NDJSON lines are routed to failure sink without failing stage", async () => {
    await runInTemp("jio-ovf-ndjson", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // Tool prints valid JSON, garbage, then valid JSON
      const toolPath = path.join(tmp, "tools", "echo-mixed.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"ok":1}');
console.log('not json at all');
console.log('{"ok":2}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const sinkFile = path.join(tmp, "sink.jsonl");
      const specPath = path.join(tmp, "mixed.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "mixed",
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
          stdoutTransform: { shell: "cat", format: "ndjson" },
          onValidationFailure: { shell: `cat >> ${sinkFile}` },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const out = await $({ stdio: "pipe" })`jio io.example.mixed`;
      const lines = String(out.stdout).trim().split(/\n+/);
      if (!(lines.includes('{"ok":1}') && lines.includes('{"ok":2}'))) {
        console.error("missing valid lines:", lines);
        process.exit(2);
      }
      // Stage should succeed; sink should contain at least one JSON error object
      const sinkTxt = await fsp.readFile(sinkFile, "utf8").catch(() => "");
      if (!sinkTxt.trim()) {
        console.error("expected failure sink to capture invalid line diagnostics");
        process.exit(2);
      }
      const sinkLines = sinkTxt.trim().split(/\n+/);
      let parsed: any;
      try {
        parsed = JSON.parse(sinkLines[0]);
      } catch {
        console.error("failure sink line is not JSON:", sinkLines[0]);
        process.exit(2);
      }
      // Verify expected diagnostic shape from runner
      if (
        !(
          parsed &&
          (parsed.reason === "output" || parsed.reason === "stdout") &&
          typeof parsed.message === "string"
        )
      ) {
        console.error("unexpected sink object shape:", parsed);
        process.exit(2);
      }
    });
  });
});
