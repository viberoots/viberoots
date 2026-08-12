#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { descendantPids, installZxProcessKill, killZxProcessTree } from "../../dev/zx-init.mjs";

test("zx-init loads its process-kill helper from the same source root", async () => {
  const source = await fsp.readFile(new URL("../../dev/zx-init.mjs", import.meta.url), "utf8");
  assert.match(source, /await import\("\.\/zx-process-kill\.mjs"\)/);
  assert.match(source, /await import\("\.\/verify\/owner-pid\.mjs"\)/);
  assert.doesNotMatch(source, /pathMod\.join\([^\n]*zx-process-kill\.mjs/);
  assert.doesNotMatch(source, /pathMod\.join\([^\n]*owner-pid\.mjs/);
});

test("zx kill uses numeric process rows and signals descendants before the process group", async () => {
  assert.deepEqual(descendantPids(["10 1", "11 10", "12 11", "13 10"], 10), [12, 11, 13]);
  const signals: Array<[number, NodeJS.Signals]> = [];
  await killZxProcessTree(10, "SIGTERM", {
    inspect: async () => ["10 1", "11 10", "12 11", "13 10"],
    signal: (pid, signal) => signals.push([pid, signal]),
  });
  assert.deepEqual(signals, [
    [12, "SIGTERM"],
    [11, "SIGTERM"],
    [13, "SIGTERM"],
    [-10, "SIGTERM"],
  ]);

  const zx: { kill?: typeof killZxProcessTree } = {};
  installZxProcessKill(zx);
  if (process.platform === "win32") assert.equal(zx.kill, undefined);
  else assert.equal(zx.kill, killZxProcessTree);
});
