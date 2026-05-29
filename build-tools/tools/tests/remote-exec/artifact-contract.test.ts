#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  remoteArtifactDefinition,
  remoteArtifactPath,
  remoteDigestSidecarPath,
  remotePassArtifactDir,
  remoteRunArtifactDir,
  remoteTargetArtifactDir,
  safeArtifactSegment,
} from "../../remote-exec/artifact-contract";

test("remote artifact contract lays out run, pass, and target directories", () => {
  assert.equal(remoteRunArtifactDir("/artifacts", "verify"), "/artifacts/runs/verify");
  assert.equal(
    remotePassArtifactDir("/artifacts", "resource limited"),
    "/artifacts/runs/verify/passes/resource_limited",
  );
  assert.equal(
    remoteTargetArtifactDir({
      root: "/artifacts",
      passName: "shared",
      target: "//pkg/app:test (prelude//platforms:default)",
    }),
    "/artifacts/runs/verify/passes/shared/targets/pkg_app_test_prelude_platforms_default",
  );
});

test("remote artifact contract defines digest sidecars and wrapper categories", () => {
  const rawCoverage = remoteArtifactPath({
    root: "/artifacts",
    passName: "shared",
    category: "raw-coverage",
    target: "//pkg:test",
  });
  assert.equal(
    rawCoverage,
    "/artifacts/runs/verify/passes/shared/targets/pkg_test/node-v8-coverage",
  );
  assert.equal(remoteDigestSidecarPath(rawCoverage), `${rawCoverage}.sha256`);

  assert.equal(remoteArtifactDefinition("nix-build-log").retention, "debug-on-failure");
  assert.equal(remoteArtifactDefinition("store-path-manifest").contentType, "application/json");
  assert.equal(remoteArtifactDefinition("source-snapshot-manifest").scope, "target");
  assert.equal(
    remoteArtifactDefinition("remote-conformance-evidence").retention,
    "conformance-evidence",
  );
});

test("remote artifact contract records redaction and retention for debug materialization", () => {
  assert.equal(
    remoteArtifactDefinition("failed-input-materialization").redaction,
    "sensitive-debug",
  );
  assert.equal(
    remoteArtifactDefinition("failed-output-materialization").retention,
    "debug-on-failure",
  );
  assert.equal(
    remoteArtifactDefinition("failed-materialization-policy").redaction,
    "redacted-summary",
  );
  assert.equal(safeArtifactSegment(""), "unnamed");
});
