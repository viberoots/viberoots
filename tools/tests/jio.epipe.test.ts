#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio EPIPE handling", () => {
  test("exits 0 when downstream closes early (head -n 1)", async () => {
    await runInTemp("jio-epipe", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "spam.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
let i=0; const it=setInterval(()=>console.log(JSON.stringify({i:i++})),1);
setTimeout(()=>clearInterval(it), 5000);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      const specPath = path.join(tmp, "spam.tool.json");
      const spec = defineToolSpec({
        tool: { name: "spam", outputSchema: { type: "object" } },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
        },
      });
      await fsp.writeFile(specPath, JSON.stringify(spec, null, 2), "utf8");
      const res = await $({
        cwd: tmp,
        stdio: "pipe",
      })`bash --noprofile --norc -c ${`jio io.example.spam | head -n 1`}`;
      const code = Number((res as any)?.exitCode ?? 0);
      if (code !== 0) {
        console.error("expected exit 0 on broken pipe, got:", code);
        process.exit(2);
      }
    });
  });
});
