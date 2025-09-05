#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, test } from "node:test";

describe("jio mcp — stdio notify smoke", () => {
  test("emits a progress notification on call start", async () => {
    const transport = new StdioClientTransport({
      command: "jio",
      args: ["--mcp-server"],
      stderr: "pipe",
      env: {
        ...(process.env as any),
        JIO_ROOT: (process.env.WORKSPACE_ROOT as string) || process.cwd(),
      },
    } as any);
    const c = new Client({ name: "test", version: "0" });
    let seen = false;
    // raw message path
    (transport as any).onmessage = (msg: any) => {
      try {
        if (msg && msg.method === "notifications/progress") seen = true;
      } catch {}
    };
    const { ProgressNotificationSchema } = await import("@modelcontextprotocol/sdk/types.js");
    (c as any).setNotificationHandler?.(ProgressNotificationSchema as any, (note: any) => {
      try {
        const p = (note as any)?.params || {};
        if (p && (p.message != null || p.item != null)) seen = true;
      } catch {}
    });
    await c.connect(transport as any);
    const tools = await c.listTools({});
    // Pick any available tool; fall back to examples.ls
    const t =
      tools.tools.find((x: any) => x.name === "io.example.examples.ls") || (tools.tools[0] as any);
    if (!t) {
      console.error("no tools available to invoke");
      await c.close().catch(() => {});
      process.exit(2);
    }
    // Fire-and-wait: call the tool and allow a brief window for a progress note
    const p = c.callTool({ name: t.name, arguments: {} } as any).catch(() => ({}) as any);
    // wait up to ~2s for a notification
    const start = Date.now();
    while (!seen && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (!seen) {
      console.error("expected at least one progress notification over stdio");
      await c.close().catch(() => {});
      process.exit(2);
    }
    await p.catch(() => ({}) as any);
    await c.close().catch(() => {});
  });
});
