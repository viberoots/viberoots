#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSharedSeedStagePin, stageSeedStore } from "../../dev/verify/seed-staging";

test("shared seed pins survive a lexical-to-canonical stage-root alias", async () => {
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

    const stagedA = await stageSeedStore(sourceA, "outer-key", 60_000);
    const pin = await createSharedSeedStagePin(stagedA, "outer-run");
    assert.ok(pin, "expected aliased stage path to produce a shared pin");

    await stageSeedStore(sourceB, "nested-key", 60_000);
    await fsp.access(stagedA);
  } finally {
    if (previous === undefined) delete process.env.VBR_VERIFY_SEED_STAGE_ROOT;
    else process.env.VBR_VERIFY_SEED_STAGE_ROOT = previous;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
