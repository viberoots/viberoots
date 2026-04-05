#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVerifyTestEnvArgs,
  previewVerifyNestedBuckIsolation,
} from "../../dev/verify/buck2-test-env.ts";

test("verify child env reuses a shared nested buck isolation per pass", () => {
  const shared = previewVerifyNestedBuckIsolation("v-123", "shared");
  const isolated = previewVerifyNestedBuckIsolation("v-123", "isolated://foo:bar");
  assert.equal(shared, previewVerifyNestedBuckIsolation("v-123", "shared"));
  assert.notEqual(shared, isolated);
  assert.match(shared, /^verify-nested-123-/);
  assert.match(isolated, /^verify-nested-123-/);

  const envArgs = buildVerifyTestEnvArgs({
    iso: "v-123",
    passName: "shared",
    zxNodeModulesOut: "/tmp/zx-node-modules",
    nodeTestTimeoutMs: 120_000,
    testNixTimeoutSecs: 1800,
  });
  assert.ok(envArgs.includes(`BUCK_NESTED_ISO=${shared}`));
  assert.ok(envArgs.includes("BUCK_EXPORTER_REUSE_DAEMON=1"));
});
