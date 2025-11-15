#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFlagStr } from "../../lib/cli.ts";

test("cli helpers: precedence argv object over process.argv over default", () => {
  const oldGlobal = (globalThis as any).argv;
  const oldArgv = process.argv.slice();
  try {
    (globalThis as any).argv = { foo: "fromGlobal" };
    process.argv = ["node", "script", "--foo=fromProcess"];
    assert.equal(getFlagStr("foo", "def"), "fromGlobal");

    delete (globalThis as any).argv;
    process.argv = ["node", "script", "--foo=fromProcess"];
    assert.equal(getFlagStr("foo", "def"), "fromProcess");

    process.argv = ["node", "script"];
    assert.equal(getFlagStr("bar", "def"), "def");
  } finally {
    (globalThis as any).argv = oldGlobal;
    process.argv = oldArgv;
  }
});
