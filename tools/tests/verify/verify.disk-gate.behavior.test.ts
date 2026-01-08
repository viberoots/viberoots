#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeVerifyDiskGateFailure,
  VERIFY_DISK_GATE_EXIT_CODE,
} from "../../dev/verify/housekeeping.ts";

test("verify disk gate decision is deterministic and message is stable", () => {
  assert.equal(VERIFY_DISK_GATE_EXIT_CODE, 2);

  assert.equal(
    computeVerifyDiskGateFailure({ freeGiB: 20, targetFreeGiB: 20 }),
    null,
    "expected disk gate to pass when freeGiB meets target",
  );

  const msg = computeVerifyDiskGateFailure({ freeGiB: 3, targetFreeGiB: 20 });
  assert.ok(msg, "expected disk gate to fail when freeGiB is below target");
  assert.ok(msg.includes("refused to start"), "expected stable refusal wording");
  assert.ok(msg.includes("need: >=20GiB"), "expected target included in message");
  assert.ok(msg.includes("have: ~3GiB"), "expected freeGiB included in message");
  assert.ok(msg.includes("VERIFY_TARGET_FREE_GB"), "expected override hint included");
});
