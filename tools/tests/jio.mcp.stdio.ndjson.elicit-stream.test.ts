#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, test } from "node:test";

describe("jio mcp — stdio ndjson elicit streaming continuation", () => {
  test("streams items via notifications/progress and aggregates optionally", async () => {
    const transport = new StdioClientTransport({
      command: "jio",
      args: ["--mcp-server"],
      stderr: "pipe",
      env: {
        ...(process.env as any),
        JIO_ROOT: (process.env.WORKSPACE_ROOT as string) || process.cwd(),
      },
    } as any);
    const c = new Client({ name: "test", version: "0" }, {
      capabilities: { elicitation: {} },
    } as any);
    // Auto-accept all elicitations
    (c as any).setRequestHandler?.(
      (await import("@modelcontextprotocol/sdk/types.js")).ElicitRequestSchema,
      async () => ({ action: "accept", content: {} }) as any,
    );
    let seen: any[] = [];
    const { ProgressNotificationSchema } = await import("@modelcontextprotocol/sdk/types.js");
    let resolved = false;
    const progressSeen = new Promise<void>((resolve) => {
      (c as any).setNotificationHandler?.(ProgressNotificationSchema as any, (note: any) => {
        try {
          const p = (note as any)?.params || {};
          if (p.message != null) seen.push(p.message);
          else if (typeof p.progress === "number") seen.push(p.progress);
          if (!resolved && (p.message != null || typeof p.progress === "number")) {
            resolved = true;
            resolve();
          }
        } catch {}
      });
    });
    await c.connect(transport as any);
    const tools = await c.listTools({});
    const tool = tools.tools.find((x: any) => x.name === "io.example.examples.ctlndjson");
    if (!tool) {
      console.error("ctlndjson tool not found");
      await c.close().catch(() => {});
      process.exit(2);
    }
    const p = c.callTool({ name: tool.name, arguments: {} } as any).catch(() => ({}) as any);
    // Event-driven wait for first typed notification, with a 2s cap
    await Promise.race([progressSeen, new Promise<void>((r) => setTimeout(r, 2000))]);
    if (!resolved) {
      console.error("expected streamed items over stdio", { seen });
      await c.close().catch(() => {});
      process.exit(2);
    }
    // Ensure the call completes (aggregate may or may not be present)
    await p.catch(() => ({}) as any);
    await c.close().catch(() => {});
  });
});
