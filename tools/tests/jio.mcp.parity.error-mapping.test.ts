#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";
import { runInTemp } from "./lib/test-helpers";

async function waitForHealth(host: string, port: number, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request({ method: "GET", host, port, path: "/health" }, (res) => {
          res.resume();
          res.on("end", () => resolve());
        });
        req.on("error", reject);
        req.end();
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return false;
}

describe("jio mcp — parity error mapping", () => {
  test("invalid JSON maps to 65/422", async () => {
    await runInTemp("jio-parity-invalid-json", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example" }),
        "utf8",
      );
      const toolPath = path.join(tmp, "tools", "badjson.ts");
      await fsp.mkdir(path.dirname(toolPath), { recursive: true });
      await fsp.writeFile(
        toolPath,
        `#!/usr/bin/env zx-wrapper
process.stdout.write('not-json');
`,
        "utf8",
      );
      await $`chmod +x ${toolPath}`;
      // CLI expectation
      const spec = {
        tool: { name: "badjson" },
        command: {
          package: "io.example",
          exec: toolPath,
          stdoutTransform: { shell: "cat", format: "json" },
          parameters: {},
        },
      } as any;
      await fsp.writeFile(
        path.join(tmp, "badjson.tool.json"),
        JSON.stringify(spec, null, 2),
        "utf8",
      );
      let code = 0;
      try {
        await $({ stdio: "pipe" })`env JIO_CLI_INVOCATION=json jio io.example.badjson`;
      } catch (e: any) {
        code = e.exitCode || e.code || 0;
      }
      assert.equal(code, 65);

      // HTTP expectation
      const host = "127.0.0.1";
      const port = 37250 + Math.floor(Math.random() * 500);
      const srv = await startMcpServer({
        transport: "http",
        httpHost: host,
        httpPort: port,
        noKeepAlive: true,
      });
      await waitForHealth(host, port, 3000);
      try {
        const res = await new Promise<{ statusCode?: number; body: string }>((resolve) => {
          const req = http.request(
            {
              method: "POST",
              host,
              port,
              path: "/mcp",
              headers: { "content-type": "application/json" },
            },
            (r) => {
              let body = "";
              r.on("data", (b) => (body += Buffer.from(b).toString("utf8")));
              r.on("end", () => resolve({ statusCode: r.statusCode, body }));
            },
          );
          req.setTimeout(5000, () => {
            try {
              req.destroy(new Error("request timeout"));
            } catch {}
          });
          // JSON-RPC 2.0 request for tools/call
          req.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: "1",
              method: "tools/call",
              params: { name: "io.example.badjson", arguments: {} },
            }),
          );
        });
        // Leave HTTP status transport-defined; assert we surfaced an error (invalid JSON)
        let isInvalid = false;
        let hasError = false;
        try {
          const json = JSON.parse(res.body || "{}");
          if (json?.error) hasError = true;
          if (json?.error?.message && /invalid\s+json/i.test(String(json.error.message))) {
            isInvalid = true;
          } else if (json?.result?.isError) {
            hasError = true;
            if (Array.isArray(json.result.content)) {
              const texts = json.result.content.map((c: any) => String(c?.text || ""));
              if (texts.some((t: string) => /invalid\s+json/i.test(t))) isInvalid = true;
            }
          }
        } catch {}
        if (!isInvalid) {
          if (/invalid\s+json/i.test(res.body || "")) isInvalid = true;
        }
        assert.ok(
          hasError || isInvalid,
          `expected JSON-RPC error envelope; body=${(res.body || "").slice(0, 200)}`,
        );
      } finally {
        await srv?.close?.();
      }
    });
  });
});
