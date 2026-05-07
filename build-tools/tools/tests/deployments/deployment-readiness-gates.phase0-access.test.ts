#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIRECT_UPLOAD_GATES,
  GATE5,
  evaluateConnectorDemo,
  evaluateDirectUpload,
} from "./deployment-readiness-gates.phase0-access.fixture";

test("direct-upload pilot admission can pass with Gates 1-4 only", async () => {
  const evaluation = await evaluateDirectUpload();
  assert.deepEqual(
    evaluation.readinessGates.map((entry) => entry.name),
    DIRECT_UPLOAD_GATES.map((entry) => entry.name),
  );
});

test("connector-demo admission passes with complete per-source Gate 5 evidence", async () => {
  const evaluation = await evaluateConnectorDemo();
  assert.equal(evaluation.readinessGates.length, DIRECT_UPLOAD_GATES.length + GATE5.length);
});

for (const missing of [...DIRECT_UPLOAD_GATES, ...GATE5].map((entry) => entry.name)) {
  test(`connector-demo admission rejects missing ${missing}`, async () => {
    await assert.rejects(
      evaluateConnectorDemo(missing),
      new RegExp(`requires readiness gate ${missing.replace(/[/-]/g, "\\$&")}`),
    );
  });
}
