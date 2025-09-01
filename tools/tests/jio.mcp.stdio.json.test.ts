#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";

describe("jio mcp — stdio json", () => {
  test("compiles", async () => {
    // Placeholder: real client interactions added in later PRs.
    // Keep as a smoke test to ensure server file is loadable.
    await import("../jio/mcp/server.ts");
  });
});
