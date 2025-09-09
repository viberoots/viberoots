#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("templates --json includes variables per template", async () => {
  await runInTemp("scaf-templates-json", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const res = await pipe$`scaf templates --json`;
    const arr = JSON.parse(res.stdout.trim());
    if (!Array.isArray(arr) || arr.length === 0) {
      console.error("expected templates array");
      process.exit(2);
    }
    const lib = arr.find((x: any) => x.language === "go" && x.template === "lib");
    if (!lib || !Array.isArray(lib.variables) || !lib.variables.includes("name")) {
      console.error("expected variables for go/lib to include 'name'");
      process.exit(2);
    }
  });
});
