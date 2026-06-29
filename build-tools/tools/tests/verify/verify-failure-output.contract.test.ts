import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify failures prefer log references over raw Buck output tails", async () => {
  const buck2Test = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/buck2-test.ts",
    "utf8",
  );
  const runVerify = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/run-verify.ts",
    "utf8",
  );
  const verifyPasses = await fsp.readFile(
    "viberoots/build-tools/tools/dev/verify/verify-passes.ts",
    "utf8",
  );

  assert.match(buck2Test, /const preferLogReference = Boolean\(opts\.logFile\);/);
  assert.match(
    buck2Test,
    /if \(!streamBuckOutput && !suppressFailureOutputTail && !preferLogReference\)/,
  );
  assert.match(runVerify, /ui\.warn\("verify interrupted"\);/);
  assert.match(runVerify, /ui\.warn\("verify failed"\);/);
  assert.match(runVerify, /ui\.list\(\[`log \$\{lock\.logFile\}`\]/);
  assert.match(runVerify, /suppressFailureOutputTail: \(\) => requestedExitCode !== null/);
  assert.match(verifyPasses, /suppressFailureOutputTail: opts\.suppressFailureOutputTail/);
});
