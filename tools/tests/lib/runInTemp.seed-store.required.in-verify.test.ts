#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp requires seed store path in verify mode", async () => {
  const prevSeed = process.env.BNX_TEST_SEED_STORE_PATH;
  const prevLock = process.env.BNX_VERIFY_LOCK_DIR;
  try {
    delete process.env.BNX_TEST_SEED_STORE_PATH;
    process.env.BNX_VERIFY_LOCK_DIR = "/tmp/verify-lock";
    await assert.rejects(
      async () => {
        await runInTemp("seed-required", async () => {});
      },
      (err: any) =>
        String(err?.message || "").includes("missing BNX_TEST_SEED_STORE_PATH") &&
        String(err?.message || "").includes("rerun v"),
    );
  } finally {
    if (prevSeed === undefined) delete process.env.BNX_TEST_SEED_STORE_PATH;
    else process.env.BNX_TEST_SEED_STORE_PATH = prevSeed;
    if (prevLock === undefined) delete process.env.BNX_VERIFY_LOCK_DIR;
    else process.env.BNX_VERIFY_LOCK_DIR = prevLock;
  }
});
