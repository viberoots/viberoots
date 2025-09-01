#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";

describe("jio mcp — stdio ndjson collect", () => {
  test("compiles", async () => {
    await import("../jio/mcp/server.ts");
  });
});
