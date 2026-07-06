#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { captureFlakeLockSnapshot, restoreFlakeLock } from "../../dev/dev-build/git";
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

async function commitInitialLock(tmp: string): Promise<void> {
  await $({ cwd: tmp, stdio: "ignore" })`git init`;
  await $({ cwd: tmp, stdio: "ignore" })`git config user.email test@example.com`;
  await $({ cwd: tmp, stdio: "ignore" })`git config user.name "Test User"`;
  await fsp.writeFile(path.join(tmp, "flake.lock"), '{"nodes":{}}\n', "utf8");
  await $({ cwd: tmp, stdio: "ignore" })`git add flake.lock`;
  await $({ cwd: tmp, stdio: "ignore" })`git commit -m initial`;
}

test("restoreFlakeLock restores lock files that were clean before build work", async () => {
  await runInScratchTemp("dev-build-restore-flake-lock-clean", async (tmp) => {
    await commitInitialLock(tmp);
    const snapshot = await captureFlakeLockSnapshot(tmp);
    await fsp.writeFile(path.join(tmp, "flake.lock"), '{"nodes":{"changed":{}}}\n', "utf8");

    await restoreFlakeLock(tmp, snapshot);

    assert.equal(await fsp.readFile(path.join(tmp, "flake.lock"), "utf8"), '{"nodes":{}}\n');
  });
});

test("restoreFlakeLock preserves preexisting user lock edits", async () => {
  await runInScratchTemp("dev-build-preserve-user-flake-lock", async (tmp) => {
    await commitInitialLock(tmp);
    await fsp.writeFile(path.join(tmp, "flake.lock"), '{"nodes":{"user":{}}}\n', "utf8");
    const snapshot = await captureFlakeLockSnapshot(tmp);

    await restoreFlakeLock(tmp, snapshot);

    assert.equal(
      await fsp.readFile(path.join(tmp, "flake.lock"), "utf8"),
      '{"nodes":{"user":{}}}\n',
    );
  });
});
