#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("help --json includes variables from copier.yaml", async () => {
  await runInTemp("scaf-help-json", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const res = await pipe$`scaf help go lib --json`;
    const obj = JSON.parse(res.stdout.trim());
    if (!Array.isArray(obj.variables) || !obj.variables.includes("name")) {
      console.error("expected help --json to include variables");
      process.exit(2);
    }
  });
});
