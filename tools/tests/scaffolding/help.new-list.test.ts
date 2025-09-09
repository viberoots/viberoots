#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("help new <lang> lists templates for that language", async () => {
  await runInTemp("scaf-help-new-list", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const res = await pipe$`scaf help new go`;
    const out = res.stdout;
    if (!/# Available go templates/.test(out)) {
      console.error("help new <lang> missing header");
      process.exit(2);
    }
    if (!/- lib: /.test(out)) {
      console.error("expected lib template listed for go");
      process.exit(2);
    }
  });
});
