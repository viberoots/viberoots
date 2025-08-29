#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio stdin backpressure (no transform)", () => {
  test("large input fully delivered to slow consumer without truncation", async () => {
    await runInTemp("jio-stdin-backpressure", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "slow-consumer.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
let total = 0;
for await (const chunk of process.stdin) {
  total += Buffer.from(chunk).length;
  await new Promise((r) => setTimeout(r, 1));
}
console.log(JSON.stringify({ receivedBytes: total }));
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const specPath = path.join(tmp, "slow.tool.json");
      const spec = defineToolSpec({
        tool: {
          name: "slow",
          outputSchema: {
            type: "object",
            properties: { receivedBytes: { type: "number" } },
            required: ["receivedBytes"],
          },
        },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "jq -c .", format: "json" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");

      // Generate a ~2MB input file
      const inFile = path.join(tmp, "big.input");
      const size = 2 * 1024 * 1024;
      const buf = Buffer.alloc(size, 0x61); // 'a'
      await fsp.writeFile(inFile, buf);

      const out = await $({
        cwd: tmp,
        stdio: "pipe",
      })`bash --noprofile --norc -c ${`cat '${inFile}' | jio io.example.slow`}`;
      const obj = JSON.parse(String(out.stdout || "{}"));
      if (Number(obj?.receivedBytes) !== size) {
        console.error("expected receivedBytes == size, got:", obj);
        process.exit(2);
      }
    });
  });
});
