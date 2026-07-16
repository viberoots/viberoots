#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isProcessInspectionPathAllowed,
  scanProcessInspectionText,
  scanProcessInspectionTree,
} from "../../lib/process-inspection-scanner";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("process inspection commands stay in reviewed helper modules", async () => {
  const hits = await scanProcessInspectionTree({ root: viberootsSourcePath("") });

  if (hits.length > 0) {
    throw new Error(
      [
        "Found direct process-inspection command usage outside reviewed helper modules.",
        "Route new usage through an existing process helper or add a narrowly reviewed allowlist entry.",
        ...hits.slice(0, 120),
      ].join("\n"),
    );
  }
});

test("process inspection scanner preserves positive, negative, and project allowlist behavior", () => {
  assert.deepEqual(scanProcessInspectionText("projects/apps/demo/src/run.ts", "ps -axo pid"), [
    "projects/apps/demo/src/run.ts:1 direct ps command",
  ]);
  assert.deepEqual(scanProcessInspectionText("projects/apps/demo/src/run.ts", "elapsed = 1"), []);
  assert.equal(isProcessInspectionPathAllowed("projects/apps/demo/e2e/process-control.ts"), true);
  assert.deepEqual(
    scanProcessInspectionText("projects/apps/demo/e2e/process-control.ts", "pkill worker"),
    [],
  );
});
