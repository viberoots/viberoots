#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasShortFlag, parseFlagMap, removeKnownFlags } from "../../lib/cli.ts";

test("cli helpers: parseFlagMap supports --key=value and presence flags, preserves positionals", () => {
  const oldArgv = process.argv.slice();
  try {
    process.argv = [
      "node",
      "script",
      "new",
      "thing",
      "--path=apps/demo",
      "--yes",
      "--kv=value",
      "--x",
      "y",
    ];
    const { positionals, flags } = parseFlagMap();
    assert.deepEqual(positionals, ["new", "thing", "y"]);
    assert.equal(flags["path"], "apps/demo");
    assert.equal(flags["yes"], "true");
    assert.equal(flags["kv"], "value");
    // two-token form is intentionally not treated as key=value
    assert.equal(flags["x"], "true");
  } finally {
    process.argv = oldArgv;
  }
});

test("cli helpers: hasShortFlag detects -v", () => {
  const oldArgv = process.argv.slice();
  try {
    process.argv = ["node", "script", "-v"];
    assert.equal(hasShortFlag("v"), true);
    assert.equal(hasShortFlag("x"), false);
  } finally {
    process.argv = oldArgv;
  }
});

test("cli helpers: removeKnownFlags drops only specified flags and preserves all other tokens", () => {
  const raw = ["--impure", "build", "//...", "--config", "foo", "--no-materialize=false"];
  const { argv, seen } = removeKnownFlags(raw, {
    presence: ["--impure", "--no-materialize"],
    takesValue: [],
  });
  assert.deepEqual(argv, ["build", "//...", "--config", "foo"]);
  assert.equal(Object.prototype.hasOwnProperty.call(seen, "--impure"), true);
  assert.equal(seen["--impure"], "");
  assert.equal(seen["--no-materialize"], "false");
});
