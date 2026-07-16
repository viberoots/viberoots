#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../../dev/verify/verify-passes.ts");
const runnerPath = path.resolve(here, "../../dev/verify/verify-pass-runner.ts");
const runVerifyPath = path.resolve(here, "../../dev/verify/run-verify.ts");

test("failed verify pass groups do not skip later pass groups", () => {
  const source = fs.readFileSync(sourcePath, "utf8");
  const cleanupBlock = source.match(
    /if \(status !== 0\) \{\s*for \(const run of running\)[\s\S]*?\n    \}/,
  );
  assert.ok(cleanupBlock, "expected failed-pass cleanup block");
  assert.doesNotMatch(
    cleanupBlock[0],
    /\bbreak\s*;/,
    "failed pass-group cleanup must not make verify fail-fast across later groups",
  );
});

test("requested verify shutdown stops scheduling later pass groups", () => {
  const source = fs.readFileSync(sourcePath, "utf8");
  const runner = fs.readFileSync(runnerPath, "utf8");
  const runVerify = fs.readFileSync(runVerifyPath, "utf8");

  assert.match(source, /shouldAbort\?: \(\) => boolean;/);
  assert.match(source, /const shouldAbort = \(\) => opts\.shouldAbort\?\.\(\) === true;/);
  assert.match(source, /shouldAbort,/);
  assert.match(runner, /shouldAbort: \(\) => boolean;/);
  assert.match(runner, /if \(opts\.shouldAbort\(\)\) return null;/);
  assert.match(source, /if \(run\) trackRun\(run\);/);
  assert.match(
    source,
    /if \(shouldAbort\(\)\) \{\s*await appendVerifyPassLog\(opts\.logFile, "\[verify\] target pass scheduling aborted"\);\s*break;/,
  );
  assert.match(source, /await waitOrAbort\(delaySeconds \* 1000\);/);
  assert.match(runVerify, /shouldAbort: \(\) => requestedExitCode !== null/);
});
