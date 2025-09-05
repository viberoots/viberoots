#!/usr/bin/env zx-wrapper
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, test } from "node:test";

describe("jio mcp — stdio ndjson output schema registration", () => {
  test("omits outputSchema when streamingFinalAggregate=false; includes wrapper when true", async () => {
    // Default (false)
    const t1 = new StdioClientTransport({
      command: "jio",
      args: ["--mcp-server"],
      stderr: "pipe",
    } as any);
    const c1 = new Client({ name: "test", version: "0" }, {} as any);
    await c1.connect(t1 as any);
    const tools1 = await c1.listTools({});
    const nd1 = tools1.tools.find((x: any) => x.name === "io.example.examples.ctlndjson_ignore");
    const js1 = tools1.tools.find((x: any) => x.name === "io.example.examples.ctljson");
    if (!nd1 || !js1) {
      await c1.close().catch(() => {});
      return;
    }
    if ((nd1 as any).outputSchema) {
      console.error("expected NDJSON tool to omit outputSchema when aggregate=false (stdio)");
      process.exit(2);
    }
    if (!(js1 as any).outputSchema) {
      console.error("expected JSON tool to include outputSchema (stdio)");
      process.exit(2);
    }
    await c1.close().catch(() => {});

    // Enable aggregate
    const t2 = new StdioClientTransport({
      command: "jio",
      args: ["--mcp-server", "--streaming-final-aggregate"],
      stderr: "pipe",
    } as any);
    const c2 = new Client({ name: "test", version: "0" }, {} as any);
    await c2.connect(t2 as any);
    const tools2 = await c2.listTools({});
    const nd2 = tools2.tools.find((x: any) => x.name === "io.example.examples.ctlndjson_ignore");
    if (!nd2) {
      console.error("ctlndjson_ignore not found (stdio)");
      process.exit(2);
    }
    if (!(nd2 as any).outputSchema) {
      console.error(
        "expected NDJSON tool to include wrapper outputSchema when aggregate=true (stdio)",
      );
      process.exit(2);
    }
    await c2.close().catch(() => {});
  });
});
