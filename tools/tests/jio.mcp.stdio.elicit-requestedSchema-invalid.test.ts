#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, test } from "node:test";

describe("jio mcp — stdio elicit requestedSchema invalid warns (smoke)", () => {
  test("flow continues with elicitation despite invalid requestedSchema", async () => {
    const transport = new StdioClientTransport({
      command: "jio",
      args: ["--mcp-server"],
      stderr: "pipe",
    } as any);
    const c = new Client({ name: "test", version: "0" }, {
      capabilities: { elicitation: {} },
    } as any);
    (c as any).setRequestHandler?.(
      (await import("@modelcontextprotocol/sdk/types.js")).ElicitRequestSchema,
      async () => ({ action: "accept", content: {} }) as any,
    );
    await c.connect(transport as any);
    const tools = await c.listTools({});
    const tool = tools.tools.find((x: any) => x.name === "io.example.examples.ctlndjson");
    await c.callTool({ name: tool?.name || "io.example.examples.ctlndjson", arguments: {} } as any);
    await c.close().catch(() => {});
  });
});
