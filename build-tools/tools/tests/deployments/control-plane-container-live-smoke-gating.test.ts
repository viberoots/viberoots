#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";

test("optional live container smoke is gated by explicit operator configuration", (t) => {
  const required = [
    "VBR_CONTROL_PLANE_LIVE_SMOKE",
    "VBR_CONTROL_PLANE_LIVE_IMAGE",
    "VBR_CONTROL_PLANE_LIVE_DATABASE_URL_FILE",
    "VBR_CONTROL_PLANE_LIVE_ARTIFACT_ENDPOINT_FILE",
    "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_DIR",
  ];
  const missing = required.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length > 0) {
    t.skip(`optional live smoke disabled; missing ${missing.join(", ")}`);
    return;
  }
  assert.equal(process.env.VBR_CONTROL_PLANE_LIVE_SMOKE, "1");
});
