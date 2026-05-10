#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "./test-helpers";

test("runInTemp seed repo does not leak mutations across temp repos", async () => {
  assert.ok(
    process.env.VBR_TEST_SEED_STORE_PATH,
    "expected verifier to provide VBR_TEST_SEED_STORE_PATH",
  );

  const realRepoRoot = process.cwd();
  const targetRel = "flake.nix";
  const realPath = path.join(realRepoRoot, targetRel);
  const original = await fsp.readFile(realPath, "utf8");

  await runInTemp("seed-isolation-1", async (tmp) => {
    const p = path.join(tmp, targetRel);
    await fsp.access(p, fs.constants.W_OK);
    await fsp.appendFile(p, "\nseed-isolation-test: mutated\n", "utf8");
  });

  await runInTemp("seed-isolation-2", async (tmp) => {
    const p = path.join(tmp, targetRel);
    const now = await fsp.readFile(p, "utf8");
    assert.equal(
      now,
      original,
      "expected second temp repo to start from a clean seed (no mutation leakage)",
    );
  });
});
