#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { describe, test } from "node:test";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

describe("jio handler participates in timeout kill group", () => {
  test("timeout closes handler stdin then kills group", async () => {
    await runInTemp("jio-handler-timeout", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "spam-invalid.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
let i=0; setInterval(() => console.log('not-json-'+(i++)), 1);
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;

      const sinkPath = path.join(
        tmp,
        `errors-${Date.now()}-${Math.random().toString(36).slice(2)}.ndjson`,
      );
      const spec = defineToolSpec({
        tool: { name: "ht" },
        command: {
          package: "io.example",
          exec: toolPath,
          parameters: {},
          stdoutTransform: { shell: "cat", format: "ndjson" },
          onValidationFailure: { shell: `tee -a ${sinkPath}` },
          timeoutMs: 500,
        },
      });
      await fsp.writeFile(path.join(tmp, "ht.tool.json"), JSON.stringify(spec, null, 2), "utf8");

      process.env.JIO_SECRETS_DISABLE = "1";
      let failed = false;
      try {
        await $({ stdio: "pipe" })`jio io.example.ht`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        if (!/timeout — sent SIGTERM/i.test(err)) {
          console.error("expected timeout note, got:", err);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero due to timeout");
        process.exit(2);
      }
      // ensure handler received some lines but process exited
      const txt = await fsp.readFile(sinkPath, "utf8").catch(() => "");
      if (!txt) {
        console.error("expected handler to receive lines before timeout");
        process.exit(2);
      }
    });
  });
});
