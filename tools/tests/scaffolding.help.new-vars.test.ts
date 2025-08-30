#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("help new <lang> <template> shows variables preview", async () => {
  await runInTemp("scaf-help-new-vars", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const res = await pipe$`scaf help new go lib`;
    const out = res.stdout;
    if (!/Usage: scaf new/.test(out)) {
      console.error("help new <lang> <tmpl> missing usage");
      process.exit(2);
    }
    if (!/Variables:\n/.test(out) && !/Variables:/.test(out)) {
      console.error("help new <lang> <tmpl> missing variables header");
      process.exit(2);
    }
    if (!/- name/.test(out)) {
      console.error("expected 'name' in variables list");
      process.exit(2);
    }
  });
});
