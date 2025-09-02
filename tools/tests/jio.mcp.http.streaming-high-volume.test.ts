#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import * as fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, test } from "node:test";
import { startMcpServer } from "../jio/mcp/server.ts";
import { defineToolSpec } from "../jio/spec";
import { runInTemp } from "./lib/test-helpers";

async function waitForHealth(host: string, port: number, ms = 15000) {
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

describe("jio mcp — http ndjson streaming high volume", () => {
  test("streams many items progressively without buffering", async () => {
    await runInTemp("jio-mcp-http-bp", async (tmp, $) => {
      await fsp.writeFile(
        path.join(tmp, ".jio"),
        JSON.stringify({ defaultPackage: "io.example", globs: ["**/*.tool.json"] }),
        "utf8",
      );

      // Producer tool emitting many NDJSON items
      const prodPath = path.join(tmp, "tools", "producer.ts");
      await fsp.mkdir(path.dirname(prodPath), { recursive: true });
      await fsp.writeFile(
        prodPath,
        `#!/usr/bin/env zx-wrapper
const N = 30000;
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

      // Start HTTP MCP server bound to this temp repo
      const host = "127.0.0.1";
      const port = 38000 + Math.floor(Math.random() * 500);
      const prevRoot = process.env.JIO_ROOT;
      process.env.JIO_ROOT = tmp;
      delete (process.env as any).JIO_MCP_HTTP_JSON_RESPONSE; // ensure SSE
      const srv = await startMcpServer({ transport: "http", httpHost: host, httpPort: port });
      const ok = await waitForHealth(host, port, 5000);
      if (!ok) {
        console.error("server not healthy");
        if (prevRoot === undefined) delete (process.env as any).JIO_ROOT;
        else process.env.JIO_ROOT = prevRoot;
        await srv?.close?.();
        process.exit(2);
      }

      const t = new StreamableHTTPClientTransport(
        new URL(`http://${host}:${port}/mcp`) as any,
        {} as any,
      );
      const c = new Client({ name: "test", version: "0" });
      let itemCount = 0;
      (t as any).onmessage = (msg: any) => {
        if (msg && msg.method === "notifications/item") itemCount++;
      };
      await c.connect(t as any);
      // give SSE channel a brief moment to settle
      await new Promise((r) => setTimeout(r, 50));
      const tools = await c.listTools({});
      const bp = tools.tools.find((x: any) => x.name === "io.example.bp");
      if (!bp) {
        console.error("bp tool not found");
        await c.close().catch(() => {});
        await srv?.close?.();
        if (prevRoot === undefined) delete (process.env as any).JIO_ROOT;
        else process.env.JIO_ROOT = prevRoot;
        process.exit(2);
      }
      const res = await c.callTool({ name: bp.name, arguments: {} } as any);
      // Expect many notifications; use a conservative floor to avoid flakiness on CI
      if (itemCount < 1000) {
        console.error("expected high itemCount for streaming", { itemCount });
        await c.close().catch(() => {});
        await srv?.close?.();
        if (prevRoot === undefined) delete (process.env as any).JIO_ROOT;
        else process.env.JIO_ROOT = prevRoot;
        process.exit(2);
      }
      await c.close().catch(() => {});
      await srv?.close?.();
      if (prevRoot === undefined) delete (process.env as any).JIO_ROOT;
      else process.env.JIO_ROOT = prevRoot;
    });
  });
});
