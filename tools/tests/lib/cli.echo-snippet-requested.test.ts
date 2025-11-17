#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { echoSnippetRequested } from "../../lib/cli.ts";

test("cli helpers: echoSnippetRequested respects --echo-snippet flag", () => {
  const oldGlobal = (globalThis as any).argv;
  const oldArgv = process.argv.slice();
  const oldEnv = { ...process.env };
  try {
    delete (globalThis as any).argv;
    process.argv = ["node", "script"];
    delete process.env.PATCH_GO_ECHO_SNIPPET;
    assert.equal(echoSnippetRequested({ env: "PATCH_GO_ECHO_SNIPPET" }), false);

    process.argv = ["node", "script", "--echo-snippet"];
    assert.equal(echoSnippetRequested({ env: "PATCH_GO_ECHO_SNIPPET" }), true);
  } finally {
    (globalThis as any).argv = oldGlobal;
    process.argv = oldArgv;
    process.env = oldEnv;
  }
});

test("cli helpers: echoSnippetRequested respects language-specific env", () => {
  const oldGlobal = (globalThis as any).argv;
  const oldArgv = process.argv.slice();
  const oldEnv = { ...process.env };
  try {
    delete (globalThis as any).argv;
    process.argv = ["node", "script"];
    process.env.PATCH_CPP_ECHO_SNIPPET = "1";
    assert.equal(echoSnippetRequested({ env: "PATCH_CPP_ECHO_SNIPPET" }), true);
  } finally {
    (globalThis as any).argv = oldGlobal;
    process.argv = oldArgv;
    process.env = oldEnv;
  }
});
