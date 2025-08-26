#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../json-cli/spec";

describe("json-cli onValidationFailure routing", () => {
  test("routes invalid output items to handler as NDJSON", async () => {
    await runInTemp("json-cli-fail-output", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // Command that prints some invalid JSON lines mixed with valid
      const toolPath = path.join(tmp, "tools", "emit-mixed.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('not-json');
console.log('{"ok":1}');
console.log('{"bad":true}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const errsPath = path.join(tmp, "errors.ndjson");

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
          onValidationFailure: { shell: `tee -a ${errsPath}` },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const out = await $({ stdio: "pipe" })`json-cli io.example.mixed`;
      const lines = String(out.stdout).trim().split(/\n+/);
      if (!lines.includes('{"ok":1}')) {
        console.error("valid line not passed through");
        process.exit(2);
      }

      const errTxt = await fsp.readFile(errsPath, "utf8").catch(() => "");
      const errLines = errTxt.trim().split(/\n+/).filter(Boolean);
      if (errLines.length < 2) {
        console.error("expected at least 2 failure lines (stdout parse + output schema)");
        process.exit(2);
      }
      for (const s of errLines) {
        try {
          const obj = JSON.parse(s);
          if (!obj.reason) throw new Error("missing reason");
        } catch {
          console.error("failure handler line not JSON:", s);
          process.exit(2);
        }
      }
    });
  });
});
