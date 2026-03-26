#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

test("json-prompt-lib: help subcommand prints usage without requiring stdin", async () => {
  const { stdout } = await execFile("build-tools/tools/bin/json-prompt", ["help"], {
    cwd: process.cwd(),
    env: process.env,
  });
  assert.match(String(stdout), /^Usage:\n  json-prompt <json-object> \[options]/);
  assert.match(String(stdout), /--rules <json>/);
  assert.match(String(stdout), /--rules-file <path>/);
  assert.match(String(stdout), /--output json\|named-args/);
  assert.match(String(stdout), /json-prompt help/);
});

test("json-prompt-lib: reserved help flags do not trigger usage output at the CLI", async () => {
  const { stdout } = await execFile(
    "build-tools/tools/bin/json-prompt",
    [
      '{"help":"Detailed help text","h":"Short help text"}',
      "--rules",
      '{"reservedFlagsAsFields":{"--help":"help","-h":"h"}}',
      "--help",
      "Detailed help text",
      "-h",
      "Short help text",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
    },
  );
  assert.deepEqual(JSON.parse(String(stdout)), {
    help: "Detailed help text",
    h: "Short help text",
  });
});
