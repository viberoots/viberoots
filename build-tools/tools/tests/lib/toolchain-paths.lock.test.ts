import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "./test-helpers/toolchain-paths";

async function makeTempRoot(): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), "toolchain-paths-lock-"));
}

test("toolchain path generation lock removes stale ownerless locks", async () => {
  const root = await makeTempRoot();
  const lockDir = path.join(root, "buck-out", "tmp", "locks", "toolchain-paths-generation.lock");
  await fsp.mkdir(lockDir, { recursive: true });
  const old = new Date(Date.now() - 10 * 60 * 1000);
  await fsp.utimes(lockDir, old, old);

  let ran = false;
  await __test.withToolchainGenerationLock({
    root,
    isReady: async () => false,
    fn: async () => {
      ran = true;
    },
  });

  assert.equal(ran, true);
  assert.equal(
    await fsp
      .stat(lockDir)
      .then(() => true)
      .catch(() => false),
    false,
  );
});

test("toolchain path generation lock removes locks owned by dead pids", async () => {
  const root = await makeTempRoot();
  const lockDir = path.join(root, "buck-out", "tmp", "locks", "toolchain-paths-generation.lock");
  await fsp.mkdir(lockDir, { recursive: true });
  await fsp.writeFile(
    path.join(lockDir, "owner.json"),
    JSON.stringify({ pid: 999999999, createdAt: new Date().toISOString() }) + "\n",
    "utf8",
  );

  let ran = false;
  await __test.withToolchainGenerationLock({
    root,
    isReady: async () => false,
    fn: async () => {
      ran = true;
    },
  });

  assert.equal(ran, true);
});

test("toolchain path realization progress is verbose-only", async () => {
  const source = await fsp.readFile("viberoots/build-tools/tools/dev/toolchain-paths.ts", "utf8");
  assert.ok(source.includes("function logToolchainProgress"));
  assert.ok(source.includes("isVbrVerbose()"));
  assert.equal(source.includes("console.error(`[toolchain-paths] checking"), false);
  assert.equal(source.includes("console.error(`[toolchain-paths] realizing"), false);
});
