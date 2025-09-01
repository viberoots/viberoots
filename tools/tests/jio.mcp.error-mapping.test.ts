#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import { mapExit } from "../jio/mcp/server.ts";

describe("jio mcp — error mapping", () => {
  test("maps known exit codes", async () => {
    const cases: Array<[number, string]> = [
      [1, "InvalidInput"],
      [65, "TransformError"],
      [66, "NotFound"],
      [69, "SpawnError"],
      [78, "ConfigError"],
      [124, "Timeout"],
      [2, "Error"],
    ];
    for (const [code, type] of cases) {
      const e: any = mapExit(code);
      if (e?.error?.type !== type) {
        console.error(`expected ${type} for code ${code}, got ${e?.error?.type}`);
        process.exit(2);
      }
    }
  });
});
