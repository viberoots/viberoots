#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { exactDescendantCommandPids } from "../lib/process-tree";

test("Tauri launch evidence requires the exact manifest executable below shared p", () => {
  const executable = "/nix/store/app/example.app/Contents/MacOS/example";
  const rows = [
    { pid: 10, ppid: 1, command: "p //projects/apps/example:example" },
    { pid: 11, ppid: 10, command: "rsync /source /filtered" },
    { pid: 12, ppid: 11, command: `${executable} --flag` },
    { pid: 20, ppid: 1, command: executable },
  ];
  assert.deepEqual(exactDescendantCommandPids(rows, 10, executable), [12]);
  assert.deepEqual(exactDescendantCommandPids(rows.slice(0, 2), 10, executable), []);
});
