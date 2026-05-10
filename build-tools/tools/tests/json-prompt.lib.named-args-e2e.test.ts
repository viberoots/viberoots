#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

async function jsonPromptNamedArgs(input: string, extraArgs: string[] = []): Promise<string[]> {
  const { stdout } = await execFile(
    "build-tools/tools/bin/json-prompt",
    [input, "--output=named-args", ...extraArgs],
    {
      cwd: process.cwd(),
      env: process.env,
    },
  );
  return String(stdout).trim().split(/\r?\n/).filter(Boolean);
}

function parseNamedArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; ) {
    const key = args[index] || "";
    assert.match(key, /^--[A-Za-z0-9][A-Za-z0-9-]*$/);
    const name = key.slice(2);
    const next = args[index + 1];
    if (next === undefined || String(next).startsWith("--")) {
      parsed[name] = true;
      index += 1;
      continue;
    }
    parsed[name] = next;
    index += 2;
  }
  return parsed;
}

test("json-prompt-lib: named-args output expands into another command as named arguments", async () => {
  const args = await jsonPromptNamedArgs('{"name":"Jane Doe","count":2,"enabled":true}');
  assert.deepEqual(args, ["--name", "Jane Doe", "--count", "2", "--enabled", "true"]);
});

test("json-prompt-lib: named-args output can control another command via parsed flags", async () => {
  const args = await jsonPromptNamedArgs('{"name":"Jane Doe","count":2,"enabled":true}');
  assert.deepEqual(parseNamedArgs(args), {
    name: "Jane Doe",
    count: "2",
    enabled: "true",
  });
});

test("json-prompt-lib: named-args output can emit bare flags for boolean true values", async () => {
  const args = await jsonPromptNamedArgs('{"json":true,"name":"demo"}', [
    "--rules",
    '{"fieldTypes":{"json":"boolean"},"namedArgModes":{"json":"flag"}}',
  ]);
  assert.deepEqual(args, ["--json", "--name", "demo"]);
  assert.deepEqual(parseNamedArgs(args), {
    json: true,
    name: "demo",
  });
});
