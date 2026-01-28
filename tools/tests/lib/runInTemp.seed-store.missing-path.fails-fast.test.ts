#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp fails fast when seed store path is missing", async () => {
  const prevSeed = process.env.BNX_TEST_SEED_STORE_PATH;
  const prevKey = process.env.BNX_TEST_SEED_KEY;
  const prevLock = process.env.BNX_VERIFY_LOCK_DIR;
  try {
    process.env.BNX_TEST_SEED_STORE_PATH = "/nix/store/does-not-exist-seed";
    process.env.BNX_TEST_SEED_KEY = "seed-key";
    process.env.BNX_VERIFY_LOCK_DIR = "/tmp/verify-lock";
    await assert.rejects(
      async () => {
        await runInTemp("seed-missing", async () => {});
      },
      (err: any) =>
        String(err?.message || "").includes("/nix/store/does-not-exist-seed") &&
        String(err?.message || "").includes("seed key: seed-key") &&
        String(err?.message || "").includes("rerun v"),
    );
  } finally {
    if (prevSeed === undefined) delete process.env.BNX_TEST_SEED_STORE_PATH;
    else process.env.BNX_TEST_SEED_STORE_PATH = prevSeed;
    if (prevKey === undefined) delete process.env.BNX_TEST_SEED_KEY;
    else process.env.BNX_TEST_SEED_KEY = prevKey;
    if (prevLock === undefined) delete process.env.BNX_VERIFY_LOCK_DIR;
    else process.env.BNX_VERIFY_LOCK_DIR = prevLock;
  }
});
