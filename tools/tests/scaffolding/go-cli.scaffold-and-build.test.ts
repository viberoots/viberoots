#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("go cli: scaffold and build", async () => {
  await runInTemp("go-cli-scaffold-and-build", async (_tmp, _$) => {
    const $ = _$({ stdio: "pipe" });
    await $`scaf new go cli demo-cli --yes`;
    await $`build`;
    await $`buck2 build //apps/demo-cli:demo-cli`;
  });
});
