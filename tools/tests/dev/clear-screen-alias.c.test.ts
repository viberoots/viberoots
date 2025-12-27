#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";

test("c: prints the clear+scrollback+home ANSI sequence", async () => {
  const res = await $`${process.cwd()}/tools/bin/c`.nothrow();
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout, "\u001b[2J\u001b[3J\u001b[H");
});
