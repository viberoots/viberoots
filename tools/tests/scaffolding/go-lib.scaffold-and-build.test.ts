#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go lib: scaffold and build+test", async () => {
  await runInTemp("go-lib-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go lib demo-lib --yes`;
    // Run glue via dev-build wrapper indirectly by building everything
    await $`build`;
    await $`buck2 test //libs/demo-lib:demo-lib_test`;
  });
});
