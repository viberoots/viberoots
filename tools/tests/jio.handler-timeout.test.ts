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
console.log('not-json-0');
let i=1; setInterval(() => console.log('not-json-'+(i++)), 1);
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
          // Ensure the sink writes at least one line even if stdin closes immediately
          onValidationFailure: {
            shell: `awk '{ print; has=1 } END { if (!has) print "closed" }' >> '${sinkPath}'`,
          },
          timeoutMs: 1000,
        },
      });
      await fsp.writeFile(path.join(tmp, "ht.tool.json"), JSON.stringify(spec, null, 2), "utf8");

      let failed = false;
      try {
        await $({ stdio: "pipe" })`env JIO_SECRETS_DISABLE=1 jio io.example.ht`;
      } catch (e: any) {
        const err = String(e?.stderr || e?.stdout || "");
        const code = Number((e && (e.exitCode ?? e.code)) ?? -1);
        if (!/timeout/i.test(err) && code !== 124) {
          console.error("expected timeout exit or note, got:", err || `(exitCode=${code})`);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected non-zero due to timeout");
        process.exit(2);
      }
      // ensure handler received some lines but process exited
      // Wait for the sink file to become non-empty under suite load
      const waitUntil = Date.now() + 7000;
      await new Promise((r) => setTimeout(r, 100));
      let txt = "";
      while (Date.now() < waitUntil) {
        try {
          const st = await fsp.stat(sinkPath);
          if (st.size > 0) {
            txt = await fsp.readFile(sinkPath, "utf8").catch(() => "");
            if (txt) break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!txt || txt.trim() === "") {
        console.error("expected handler to receive lines before timeout");
        process.exit(2);
      }
    });
  });
});
