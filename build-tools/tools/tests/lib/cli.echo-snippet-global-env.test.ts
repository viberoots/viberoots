#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import { echoSnippetRequested } from "../../lib/cli.ts";

test("cli helpers: echoSnippetRequested honors global PATCH_ECHO_SNIPPET", () => {
  const oldGlobal = (globalThis as any).argv;
  const oldArgv = process.argv.slice();
  const oldEnv = { ...process.env };
  try {
    delete (globalThis as any).argv;
    process.argv = ["node", "script"];
    delete process.env.PATCH_GO_ECHO_SNIPPET;
    process.env.PATCH_ECHO_SNIPPET = "1";
    assert.equal(echoSnippetRequested({ env: "PATCH_GO_ECHO_SNIPPET" }), true);
  } finally {
    (globalThis as any).argv = oldGlobal;
    process.argv = oldArgv;
    process.env = oldEnv;
  }
});
