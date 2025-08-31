#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

// Verifies rate and cap messages from the failure sink: "jio: sink limits reached ..."
describe("jio failure sink limits", () => {
  test("emits sink limits reached when rate/caps exceeded", async () => {
    await runInTemp("jio-sink-limits", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // Producer: write many invalid NDJSON items quickly so stdout validation fails and sink receives items
      const toolPath = path.join(tmp, "tools", "spam-invalid.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
for (let i = 0; i < 2000; i++) {
  console.log('{"notOk":true}');
}
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "spam-invalid.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "spam-invalid",
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
          onValidationFailure: { shell: "cat >/dev/null" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      // Use CLI flags to make sink limits very small so we exceed them
      const out = await $({
        stdio: "pipe",
      })`jio io.example.spam-invalid --sink-max-rate-per-sec 10 --sink-max-items 50 --sink-max-bytes 1024 --sink-write-timeout-ms 10 --sink-close-timeout-ms 50`;
      const stderr = String(out.stderr || out.stdout || "");
      if (!/sink limits reached/i.test(stderr)) {
        console.error("expected sink limits reached message in stderr, got:\n" + stderr);
        process.exit(2);
      }
    });
  });
});
