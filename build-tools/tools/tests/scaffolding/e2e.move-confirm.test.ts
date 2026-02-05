#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("move requires confirmation unless --yes", async () => {
  await runInTemp("scaf-move-confirm", async (_tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    const pipe$ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --path=projects/libs/demo-lib`;
    let prompted = false;
    try {
      await pipe$`scaf move projects/libs/demo-lib projects/libs/demo-moved`;
    } catch {
      prompted = true;
    }
    if (!prompted) {
      console.error("expected move without --yes to abort");
      process.exit(2);
    }
    await $`scaf move projects/libs/demo-lib projects/libs/demo-moved --yes`;
  });
});
