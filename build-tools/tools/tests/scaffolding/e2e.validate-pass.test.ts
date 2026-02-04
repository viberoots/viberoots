#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("meta: validate all passes", async () => {
  await runInTemp("tmpl-validate-pass", async (_tmp, _$) => {
    const $ = _$({ stdio: "ignore" });
    await $`scaf validate all --quiet`;
  });
});
