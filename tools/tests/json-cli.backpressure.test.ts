#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { runInTemp } from "./lib/test-helpers";
import { defineToolSpec } from "../json-cli/spec";

describe("json-cli streaming and backpressure", () => {
  test("high-volume NDJSON passes through without buffering", async () => {
    await runInTemp("json-cli-backpressure", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".json-cli"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );

      // Producer: emit N JSON lines quickly
      const prodPath = path.join(tmp, "tools", "producer.ts");
      await fsp.mkdir(path.dirname(prodPath), { recursive: true });
      await fsp.writeFile(
        prodPath,
        `#!/usr/bin/env zx-wrapper
const N = 50000;
for (let i = 0; i < N; i++) {
  console.log(JSON.stringify({i}));
}
`,
        "utf8",
      );
      await $`chmod +x ${prodPath}`;

      const specPath = path.join(tmp, "bp.tool.json");
      const spec = defineToolSpec({
        tool: { name: "bp" },
        command: {
          package: "io.example",
          exec: prodPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      const out = await $({ stdio: "pipe" })`json-cli io.example.bp`;
      const lines = String(out.stdout).trim().split(/\n+/);
      if (lines.length < 50000) {
        console.error("missing lines:", lines.length);
        process.exit(2);
      }
      // Quick spot check for structure
      const sample = JSON.parse(lines[0]);
      if (typeof sample.i !== "number") {
        console.error("unexpected sample structure:", sample);
        process.exit(2);
      }
    });
  });
});
