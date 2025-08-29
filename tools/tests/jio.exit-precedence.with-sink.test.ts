#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio exit precedence with failure sink", () => {
  test("stdinTransform parse error wins over stdout success and sink runs", async () => {
    await runInTemp("jio-exit-precedence-sink", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // Exec prints a valid line to be transformed, but stdinTransform will parse error first
      const toolPath = path.join(tmp, "tools", "echo-one.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
console.log('{"ok":1}');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const marker = path.join(tmp, "sink.txt");
      const specPath = path.join(tmp, "exitsink.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "exitsink",
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
          stdinTransform: { shell: "jq -c .", format: "json" },
          stdoutTransform: { shell: "jq -c .", format: "ndjson" },
          onValidationFailure: { shell: `echo ran >> ${marker}` },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        // Provide invalid stdin to trigger stdinTransform parse error
        await $({
          stdio: "pipe",
        })`bash --noprofile --norc -lc ${`printf %s not-json | jio io.example.exitsink`}`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/stdinTransform code=65/i.test(err)) {
          console.error("expected stdinTransform parse error precedence, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero exit due to stdin parse error");
        process.exit(2);
      }
      const markerTxt = await fsp.readFile(marker, "utf8").catch(() => "");
      if (!markerTxt.includes("ran")) {
        console.error("expected failure sink to run");
        process.exit(2);
      }
    });
  });
});
