#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { processInspectionPrefersPgrep, processStartSignature } from "../../lib/process-inspection";

test("process inspection prefers pgrep inside agent Safehouse sessions", () => {
  assert.equal(processInspectionPrefersPgrep({ VBR_CODEX_SAFEHOUSE_ACTIVE: "1" }), true);
  assert.equal(processInspectionPrefersPgrep({ VBR_CLAUDE_SAFEHOUSE_ACTIVE: "1" }), true);
  assert.equal(processInspectionPrefersPgrep({}), false);
});

test("process start signatures do not invoke ps inside Safehouse", async () => {
  const oldCodex = process.env.VBR_CODEX_SAFEHOUSE_ACTIVE;
  process.env.VBR_CODEX_SAFEHOUSE_ACTIVE = "1";
  try {
    assert.equal(await processStartSignature(process.pid), null);
  } finally {
    if (oldCodex === undefined) {
      delete process.env.VBR_CODEX_SAFEHOUSE_ACTIVE;
    } else {
      process.env.VBR_CODEX_SAFEHOUSE_ACTIVE = oldCodex;
    }
  }
});
