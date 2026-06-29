import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

test("verify pacing checkpoints are verbose-only on stderr", async () => {
  const source = await fsp.readFile("viberoots/build-tools/tools/dev/verify/buck2-test.ts", "utf8");

  assert.match(source, /const line = `\[verify\] pacing checkpoint/);
  assert.match(source, /if \(streamBuckOutput\) process\.stderr\.write\(line \+ "\\n"\);/);
  assert.match(source, /await fsp\.appendFile\(opts\.logFile!, line \+ "\\n", "utf8"\)/);
});
