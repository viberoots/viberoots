#!/usr/bin/env zx-wrapper
import { test } from "node:test";

test("node:test minimal idle exits quickly", async () => {
  const start = Date.now();
  process.once("beforeExit", (code) => {
    try {
      console.error(JSON.stringify({ type: "MIN_BEFORE_EXIT", code, dt: Date.now() - start }));
    } catch {}
  });
  process.once("exit", (code) => {
    try {
      console.error(JSON.stringify({ type: "MIN_EXIT", code, dt: Date.now() - start }));
    } catch {}
  });
});
