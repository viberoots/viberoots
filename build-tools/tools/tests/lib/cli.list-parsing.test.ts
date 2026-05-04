#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFlagList } from "../../lib/cli";

test("cli helpers: list parsing from string and array", () => {
  const oldGlobal = (globalThis as any).argv;
  const oldArgv = process.argv.slice();
  try {
    delete (globalThis as any).argv;
    process.argv = ["node", "script", "--list=a,b, c ,", "--empty-list="];
    assert.deepEqual(getFlagList("list"), ["a", "b", "c"]);
    assert.deepEqual(getFlagList("empty-list"), []);

    (globalThis as any).argv = { mods: ["x", "y", "z"] };
    process.argv = ["node", "script", "--mods=a,b"];
    // global argv array should win over process argv
    assert.deepEqual(getFlagList("mods"), ["x", "y", "z"]);
  } finally {
    (globalThis as any).argv = oldGlobal;
    process.argv = oldArgv;
  }
});
