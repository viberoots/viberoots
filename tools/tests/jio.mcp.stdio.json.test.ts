#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

describe("jio mcp — stdio json", () => {
  test("invoke JSON tool and get structured content", async () => {
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
    const jsonTool = tools.tools.find((t: any) => t.name === "io.example.examples.ls");
    assert.ok(jsonTool);
    // Input schema should be present when conversion is safe
    assert.ok(jsonTool?.inputSchema && typeof (jsonTool as any).inputSchema === "object");
    if (!jsonTool) {
      console.error("no tools registered");
      await transport.close();
      process.exit(2);
    }
    const res = await client.callTool({ name: jsonTool.name, arguments: {} });
    // Either structuredContent (object) or array for ndjson collect
    if (!res || (res.structuredContent == null && (res as any).content == null)) {
      console.error("unexpected result", res);
      await transport.close();
      process.exit(2);
    }
    // If provided, outputSchema should be an object
    if ((jsonTool as any).outputSchema) {
      assert.equal(typeof (jsonTool as any).outputSchema, "object");
    }
    await transport.close();
  });
});
