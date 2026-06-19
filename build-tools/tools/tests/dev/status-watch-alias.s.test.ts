#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";

async function findToolBin(): Promise<string> {
  for (const candidate of [
    path.join(process.cwd(), "viberoots", "build-tools", "tools", "bin"),
    path.join(process.cwd(), "viberoots", "build-tools", "tools", "bin"),
  ]) {
    try {
      const stat = await fsp.stat(path.join(candidate, "s"));
      if (stat.isFile()) {
        return candidate;
      }
    } catch {}
  }
  throw new Error("could not find viberoots/build-tools/tools/bin/s");
}

test("s: forwards to tail-log --status -w (help path)", async () => {
  const binDir = await findToolBin();
  const res = await $`${path.join(binDir, "s")} --help`.nothrow();
  // tail-log exits 2 for help, prints usage to stderr.
  assert.equal(res.exitCode, 2);
  assert.match(res.stderr, /tail-log/i);
  assert.match(res.stderr, /--status/i);
  assert.match(res.stderr, /--watch|-w/i);
});

test("s: strict consumer root resolves viberoots script paths", async () => {
  const binDir = await findToolBin();
  if (
    !binDir.includes(`${path.sep}viberoots${path.sep}build-tools${path.sep}tools${path.sep}bin`)
  ) {
    return;
  }
  const res = await $({
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  })`s --help`.nothrow();
  assert.equal(res.exitCode, 2);
  assert.match(res.stderr, /tail-log/i);
  assert.doesNotMatch(res.stderr, /ERR_MODULE_NOT_FOUND/);
});
