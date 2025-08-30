#!/usr/bin/env zx-wrapper
import { describe, test } from "node:test";
import { jioCall } from "../dev/jio-call";
import { runInTemp } from "./lib/test-helpers";

describe("jioCall helper — error path", () => {
  test("error path surfaces stderr", async () => {
    await runInTemp("jio-call-error", async (_tmp, _$) => {
      let failed = false;
      try {
        await jioCall("io.example.missing", {}, { output: "json" });
      } catch (e: any) {
        const msg = String(e?.message || e || "");
        if (!/tool not found/i.test(msg)) {
          console.error("expected not-found error surfaced, got:", msg);
          process.exit(2);
        }
        failed = true;
      }
      if (!failed) {
        console.error("expected failure for missing tool");
        process.exit(2);
      }
    });
  });
});
