#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFlagBool } from "../../lib/cli.ts";

test("cli helpers: boolean switches and equals-form booleans", () => {
  const oldGlobal = (globalThis as any).argv;
  const oldArgv = process.argv.slice();
  try {
    // Absent -> false
    delete (globalThis as any).argv;
    process.argv = ["node", "script"];
    assert.equal(getFlagBool("strict"), false);

    // Present without value -> true
    process.argv = ["node", "script", "--strict"];
    assert.equal(getFlagBool("strict"), true);

    // Equals-form explicit false
    process.argv = ["node", "script", "--strict=false"];
    assert.equal(getFlagBool("strict"), false);

    // Equals-form numeric true/false
    process.argv = ["node", "script", "--flag=1"];
    assert.equal(getFlagBool("flag"), true);
    process.argv = ["node", "script", "--flag=0"];
    assert.equal(getFlagBool("flag"), false);

    // Global argv boolean has priority
    (globalThis as any).argv = { strict: true };
    process.argv = ["node", "script", "--strict=false"];
    assert.equal(getFlagBool("strict"), true);
  } finally {
    (globalThis as any).argv = oldGlobal;
    process.argv = oldArgv;
  }
});
