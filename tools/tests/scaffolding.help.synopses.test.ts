#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "./lib/test-helpers";

test("help new/update/regen/delete shows synopsis", async () => {
  await runInTemp("scaf-help-cmds", async (_tmp, _$) => {
    const pipe$ = _$({ stdio: "pipe" });
    const hn = await pipe$`scaf help new`;
    if (!/Usage: scaf new/.test(hn.stdout)) {
      console.error("help new missing usage");
      process.exit(2);
    }
    const hu = await pipe$`scaf help update`;
    if (!/Usage: scaf update/.test(hu.stdout)) {
      console.error("help update missing usage");
      process.exit(2);
    }
    const hr = await pipe$`scaf help regen`;
    if (!/Usage: scaf regen/.test(hr.stdout)) {
      console.error("help regen missing usage");
      process.exit(2);
    }
    const hd = await pipe$`scaf help delete`;
    if (!/Usage: scaf delete/.test(hd.stdout)) {
      console.error("help delete missing usage");
      process.exit(2);
    }
  });
});
