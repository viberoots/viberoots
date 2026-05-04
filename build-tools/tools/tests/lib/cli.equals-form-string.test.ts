#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFlagStr } from "../../lib/cli";

test("cli helpers: equals-form string flag parsing (--name=value)", () => {
  const oldGlobal = (globalThis as any).argv;
  const oldArgv = process.argv.slice();
  try {
    delete (globalThis as any).argv;
    process.argv = ["node", "script", "--name=value", "--empty="];
    assert.equal(getFlagStr("name", ""), "value");
    // equals-form with empty value falls back to default
    assert.equal(getFlagStr("empty", "d"), "d");
  } finally {
    (globalThis as any).argv = oldGlobal;
    process.argv = oldArgv;
  }
});
