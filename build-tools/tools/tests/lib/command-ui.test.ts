#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCommandUi, isVbrVerbose } from "../../lib/command-ui";

test("isVbrVerbose accepts explicit truthy values only", () => {
  assert.equal(isVbrVerbose({ VBR_VERBOSE: "1" } as NodeJS.ProcessEnv), true);
  assert.equal(isVbrVerbose({ VBR_VERBOSE: "true" } as NodeJS.ProcessEnv), true);
  assert.equal(isVbrVerbose({ VBR_VERBOSE: "debug" } as NodeJS.ProcessEnv), true);
  assert.equal(isVbrVerbose({ VBR_VERBOSE: "0" } as NodeJS.ProcessEnv), false);
  assert.equal(isVbrVerbose({} as NodeJS.ProcessEnv), false);
});

test("quiet UI emits status lines and verbose UI suppresses them", () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const quiet = createCommandUi({ verbose: false });
    quiet.heading("viberoots install");
    quiet.ok("node_modules", "fresh");
    quiet.warn("low disk");
    quiet.list(["one", "two", "three"], { limit: 2 });
    quiet.list(["bad"], { stream: "stderr" });
    const verbose = createCommandUi({ verbose: true });
    verbose.heading("hidden");
    verbose.ok("hidden");
    verbose.list(["hidden"]);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  assert.match(stdout.join(""), /viberoots install/);
  assert.match(stdout.join(""), /ok\s+node_modules fresh/);
  assert.match(stdout.join(""), /    - one/);
  assert.match(stdout.join(""), /    - two/);
  assert.match(stdout.join(""), /    - \.\.\. 1 more/);
  assert.match(stderr.join(""), /warn\s+low disk/);
  assert.match(stderr.join(""), /    - bad/);
  assert.doesNotMatch(stdout.join(""), /hidden/);
});
