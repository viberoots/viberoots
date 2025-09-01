#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("jio mcp — stdio ndjson collect", () => {
  test("invoke NDJSON tool and get collected array", async () => {
    const transport = new StdioClientTransport({
      command: "jio",
      args: ["--mcp-server"],
      stderr: "pipe",
      env: {
        ...(process.env as any),
        JIO_ROOT: (process.env.WORKSPACE_ROOT as string) || process.cwd(),
      },
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    const tools = await client.listTools({});
    const ndTool = tools.tools.find((t: any) => t.name === "io.example.examples.ls");
    if (!ndTool) {
      console.error("no ndjson tools registered");
      await transport.close();
      process.exit(2);
    }
    const res = await client.callTool({ name: ndTool.name, arguments: {} });
    if (!res || (res.structuredContent == null && !Array.isArray((res as any).content))) {
      console.error("expected collected content", res);
      await transport.close();
      process.exit(2);
    }
    // If collected array, ensure it is an array
    if ((res as any).content != null) assert.ok(Array.isArray((res as any).content));
    await transport.close();
  });
});
