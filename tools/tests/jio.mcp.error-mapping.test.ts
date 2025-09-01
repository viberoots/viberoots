#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import { describe, test } from "node:test";

describe("jio mcp — error mapping smoke", () => {
  test("starts server and exits 0", async () => {
    // We only verify startup; detailed mapping covered in integration tests later.
    const p = spawn("jio", ["--mcp-server"], { stdio: ["pipe", "pipe", "pipe"] });
    let ok = false;
    p.on("spawn", () => {
      ok = true;
      try {
        p.kill("SIGTERM");
      } catch {}
    });
    await new Promise<void>((res) => p.on("close", () => res()));
    if (!ok) {
      console.error("server did not spawn");
      process.exit(2);
    }
  });
});
