#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import { spawn } from "node:child_process";

describe("jio mcp — stdio invoke JSON tool", () => {
  test("server starts (placeholder for real client invoke)", async () => {
    const p = spawn("jio", ["--mcp-server"], { stdio: ["ignore", "pipe", "pipe"] });
    let ok = false;
    p.on("spawn", () => {
      ok = true;
      try {
        p.kill("SIGTERM");
      } catch {}
    });
    await new Promise<void>((res) => p.on("close", () => res()));
    if (!ok) {
      console.error("failed to start stdio server");
      process.exit(2);
    }
  });
});
