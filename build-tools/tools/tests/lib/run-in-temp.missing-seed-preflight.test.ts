#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp rejects a missing seed before allocating owned state", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "run-in-temp-seed-preflight-"));
  const missingSeed = path.join(root, "missing-seed");
  const stateFile = path.join(root, "owned-state.txt");
  const keys = [
    "TMPDIR",
    "VBR_TEST_SEED_STORE_PATH",
    "VBR_TEST_SEED_KEY",
    "VBR_VERIFY_LOCK_DIR",
    "VBR_VERIFY_PROCESS_STATE_FILE",
    "TEST_RSYNC_ROOTS",
    "TEST_PARTIAL_CLONE_GO_ONLY",
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  let bodyRan = false;
  try {
    process.env.TMPDIR = root;
    process.env.VBR_TEST_SEED_STORE_PATH = missingSeed;
    process.env.VBR_TEST_SEED_KEY = "missing-seed-key";
    process.env.VBR_VERIFY_LOCK_DIR = path.join(root, "verify-lock");
    process.env.VBR_VERIFY_PROCESS_STATE_FILE = stateFile;
    delete process.env.TEST_RSYNC_ROOTS;
    delete process.env.TEST_PARTIAL_CLONE_GO_ONLY;

    await assert.rejects(
      runInTemp("must-not-allocate", async () => {
        bodyRan = true;
      }),
      /seed store path missing/,
    );
    assert.equal(bodyRan, false);
    assert.equal(await fsp.readdir(root).then((entries) => entries.length), 0);
    await assert.rejects(fsp.access(stateFile), { code: "ENOENT" });
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsp.rm(root, { recursive: true, force: true });
  }
});
