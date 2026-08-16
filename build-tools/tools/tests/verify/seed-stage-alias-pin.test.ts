#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSharedSeedStagePin, stageSeedStore } from "../../dev/verify/seed-staging";

const TEST_TIMEOUT_MS =
  Number(process.env.TEST_NIX_TIMEOUT_SECS || process.env.VERIFY_TIMEOUT_SECS || "600") * 1000;
const STAGE_TIMEOUT_MS = Math.max(60_000, Math.floor(TEST_TIMEOUT_MS / 4));

test(
  "shared seed pins survive a lexical-to-canonical stage-root alias",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "seed-stage-alias-pin-"));
    const canonicalRoot = path.join(tmp, "canonical-stage-root");
    const aliasRoot = path.join(tmp, "stage-root-alias");
    const sourceA = path.join(tmp, "source-a");
    const sourceB = path.join(tmp, "source-b");
    const previous = process.env.VBR_VERIFY_SEED_STAGE_ROOT;
    try {
      await Promise.all([canonicalRoot, sourceA, sourceB].map((dir) => fsp.mkdir(dir)));
      await fsp.symlink(canonicalRoot, aliasRoot);
      process.env.VBR_VERIFY_SEED_STAGE_ROOT = aliasRoot;

      const stagedA = await stageSeedStore(sourceA, "outer-key", STAGE_TIMEOUT_MS);
      const pin = await createSharedSeedStagePin(stagedA, "outer-run");
      assert.ok(pin, "expected aliased stage path to produce a shared pin");

      await stageSeedStore(sourceB, "nested-key", STAGE_TIMEOUT_MS);
      await fsp.access(stagedA);
    } finally {
      if (previous === undefined) delete process.env.VBR_VERIFY_SEED_STAGE_ROOT;
      else process.env.VBR_VERIFY_SEED_STAGE_ROOT = previous;
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  },
);
