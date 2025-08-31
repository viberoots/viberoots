#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

// Covers renderValueTokens for type=object with collectionStyle=kv
describe("jio render object kv parameters", () => {
  test("object kv renders sorted --key=value tokens", async () => {
    await runInTemp("jio-kv-object", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const dir = path.join(tmp, "t");
      await fsp.mkdir(dir, { recursive: true });
      const toolPath = path.join(tmp, "tools", "print-argv.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
for (const a of process.argv.slice(2)) console.log(JSON.stringify(a));
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const spec = defineToolSpec({
        tool: { name: "echo-argv" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {
            opts: { type: "object", collectionStyle: "kv", flag: true, path: "$.opts" },
          },
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(
        path.join(dir, "echo-argv.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );

      const inPath = path.join(tmp, "in.json");
      // Intentionally unsorted keys; renderer should sort a,b
      await fsp.writeFile(inPath, JSON.stringify({ opts: { b: 2, a: 1 } }), "utf8");
      const out = await $({ stdio: "pipe" })`jio io.example.echo-argv --in=${inPath} --collect`;
      const arr = JSON.parse(String(out.stdout || "[]"));
      const tokens = arr;
      if (tokens[0] !== "--a=1" || tokens[1] !== "--b=2") {
        console.error("expected sorted kv tokens --a=1 --b=2, got:\n" + JSON.stringify(tokens));
        process.exit(2);
      }
    });
  });
});
