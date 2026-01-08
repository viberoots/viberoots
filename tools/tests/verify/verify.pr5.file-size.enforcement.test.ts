#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";

async function loc(p: string): Promise<number> {
  const txt = await fsp.readFile(p, "utf8");
  return txt.split(/\r?\n/).length;
}

test("PR-5 file-size compliance: flake entrypoint + test-helpers facade stay <= 250 LOC", async () => {
  assert.ok((await loc("flake.nix")) <= 250, "expected flake.nix <= 250 LOC");
  assert.ok(
    (await loc("tools/tests/lib/test-helpers.ts")) <= 250,
    "expected tools/tests/lib/test-helpers.ts <= 250 LOC",
  );
});
