#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { restoreFlakeLock } from "../../dev/dev-build/git";
import { runInScratchTemp } from "../lib/test-helpers";

test("restoreFlakeLock skips unborn git repositories without noisy HEAD failures", async () => {
  await runInScratchTemp("dev-build-restore-flake-lock-unborn", async (tmp) => {
    await $({ cwd: tmp, stdio: "ignore" })`git init`;
    await fsp.writeFile(path.join(tmp, "flake.lock"), "{}\n", "utf8");
    await $({ cwd: tmp, stdio: "ignore" })`git add flake.lock`;

    const prevWrite = process.stderr.write;
    let stderr = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      await restoreFlakeLock(tmp);
    } finally {
      process.stderr.write = prevWrite;
    }

    assert.equal(stderr, "");
  });
});
