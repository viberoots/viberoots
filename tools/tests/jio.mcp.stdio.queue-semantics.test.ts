#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, test } from "node:test";

describe("jio mcp — stdio queue semantics", () => {
  test("second call rejects when queue is full and maxConcurrent reached", async () => {
    const transport = new StdioClientTransport({
      command: "jio",
      args: [
        "--mcp-server",
        "--max-concurrent-calls",
        "1",
        "--queue-size",
        "0",
        "--queue-timeout-ms",
        "1",
      ],
      stderr: "pipe",
      env: {
        ...(process.env as any),
        JIO_ROOT: (process.env.WORKSPACE_ROOT as string) || process.cwd(),
        JIO_MCP_TEST_DELAY_MS: "400",
      },
    } as any);
    const c = new Client({ name: "test", version: "0" });
    await c.connect(transport as any);
    const tools = await c.listTools({});
    const ls = tools.tools.find((t: any) => t.name === "io.example.examples.ls");
    const p1 = c.callTool({ name: ls?.name || "io.example.examples.ls", arguments: {} } as any);
    const r2 = await c
      .callTool({ name: ls?.name || "io.example.examples.ls", arguments: {} } as any)
      .then(
        (v) => ({ ok: true, v }),
        (e) => ({ ok: false, e }),
      );
    const isErr = (r2 as any)?.e || (r2 as any)?.v?.isError || (r2 as any)?.v?.error;
    if (!isErr) {
      console.error("expected busy/queue rejection for second call on stdio");
      await p1.catch(() => {});
      await c.close().catch(() => {});
      process.exit(2);
    }
    await p1.catch(() => {});
    await c.close().catch(() => {});
  });
});
