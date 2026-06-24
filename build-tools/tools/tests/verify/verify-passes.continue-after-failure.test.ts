#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../../dev/verify/verify-passes.ts");

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
