#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("new overwrite guard requires --yes or supports --dry-run", async () => {
  await runInTemp("scaf-overwrite-guard", async (_tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    const pipe$ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib`;
    let prompted = false;
    try {
      await $`scaf new go lib demo-lib`;
    } catch {
      prompted = true;
    }
    if (!prompted) {
      console.error("expected new without --yes to abort on non-empty dir");
      process.exit(2);
    }
    await $`scaf new go lib demo-lib --dry-run`;
    await $`scaf new go lib demo-lib --yes`;
  });
});
