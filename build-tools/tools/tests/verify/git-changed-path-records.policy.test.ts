#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiffNameStatusZ, parsePorcelainStatusZ } from "../../lib/git-changed-path-records";

function nul(...records: string[]): Buffer {
  return Buffer.from(records.length ? `${records.join("\0")}\0` : "");
}

test("NUL diff records preserve special paths and both rename sides", () => {
  assert.deepEqual(
    parseDiffNameStatusZ(
      nul(
        "M",
        'projects/app/ space \t line\n quote" slash\\.ts ',
        "R100",
        "outside/old\nname.ts",
        "projects/app/new\tname.ts",
      ),
    ),
    [
      'projects/app/ space \t line\n quote" slash\\.ts ',
      "outside/old\nname.ts",
      "projects/app/new\tname.ts",
    ],
  );
});

test("NUL porcelain records preserve paths and both dirty rename sides", () => {
  assert.deepEqual(
    parsePorcelainStatusZ(
      nul(
        " M projects/app/unstaged\nname.ts",
        "?? projects/app/untracked\tname.ts",
        "R  projects/app/new \\ name.ts",
        'outside/old " name.ts',
      ),
    ),
    [
      "projects/app/unstaged\nname.ts",
      "projects/app/untracked\tname.ts",
      "projects/app/new \\ name.ts",
      'outside/old " name.ts',
    ],
  );
});

test("structural Git record parsers reject malformed and truncated input", () => {
  const invalidUtf8 = Buffer.from([0x4d, 0, 0xff, 0]);
  for (const sample of [nul("R100", "old.ts"), Buffer.from("M\0path"), invalidUtf8]) {
    assert.throws(() => parseDiffNameStatusZ(sample), /missing path|truncated|invalid UTF-8/);
  }
  for (const sample of [nul("R  new.ts"), Buffer.from("?? path"), nul("bad")]) {
    assert.throws(() => parsePorcelainStatusZ(sample), /missing|truncated|malformed/);
  }
});

test("successful empty structural output remains a distinct empty result", () => {
  assert.deepEqual(parseDiffNameStatusZ(Buffer.alloc(0)), []);
  assert.deepEqual(parsePorcelainStatusZ(Buffer.alloc(0)), []);
});
