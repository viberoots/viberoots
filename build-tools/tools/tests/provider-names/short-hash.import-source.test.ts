#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("provider-names uses shortHash from providers.ts (no local duplicate)", async () => {
  const src = await readFile("viberoots/build-tools/tools/lib/provider-names.ts", "utf8");
  assert.match(
    src,
    /from\s+["']\.\/short-hash["']/,
    "expected provider-names.ts to import from ./short-hash",
  );
  assert.ok(
    !/function\s+shortHash\s*\(/.test(src),
    "expected no local shortHash implementation in provider-names.ts",
  );
});
