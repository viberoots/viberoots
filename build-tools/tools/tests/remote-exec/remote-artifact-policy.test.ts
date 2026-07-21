#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRemoteExecTargets } from "../../dev/remote-exec-policy-check";
import { remoteBuilderSmokeEvidence } from "./remote-builder-smoke-test-fixture";

const readyTarget = {
  target: "//pkg:test",
  labels: ["remote:ready", "nix-builder:inherit_config", "remote-builder-smoke:inherit_config"],
  ruleFamily: "zx_test",
  runFromProjectRoot: true,
  useProjectRelativePaths: true,
  commandInputsDeclared: true,
  nixBuilderPolicy: "inherit_config",
  remoteBuilderSmokePolicy: "inherit_config",
};

test("remote policy rejects remote-ready writes to undeclared local artifact paths", () => {
  const findings = validateRemoteExecTargets({
    mode: "remote",
    testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
    targets: [
      {
        ...readyTarget,
        undeclaredLocalArtifactPaths: ["buck-out", "/tmp", "coverage/"],
      },
    ],
    allowedProfiles: ["linux-x86_64-default"],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.target, "//pkg:test");
  assert.match(findings[0]?.message || "", /declared outputs/);
  assert.match(findings[0]?.message || "", /buck-out, \/tmp, coverage\//);
});

test("remote policy accepts local artifact-looking paths only with artifact contract evidence", () => {
  const findings = validateRemoteExecTargets({
    mode: "remote",
    testOnlyRemoteBuilderSmokeEvidence: remoteBuilderSmokeEvidence,
    targets: [
      {
        ...readyTarget,
        declaredArtifactContract: true,
        undeclaredLocalArtifactPaths: ["buck-out"],
      },
    ],
    allowedProfiles: ["linux-x86_64-default"],
  });

  assert.deepEqual(findings, []);
});
