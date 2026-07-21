#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRemoteExecTargets } from "../../dev/remote-exec-policy-check";
import { remoteBuilderSmokeEvidence } from "./remote-builder-smoke-test-fixture";

const base = {
  target: "//pkg:t",
  ruleFamily: "go_nix_test",
  labels: ["remote:ready"],
  runFromProjectRoot: true,
  useProjectRelativePaths: true,
  commandInputsDeclared: true,
  nixBuilderPolicy: "inherit_config",
  remoteBuilderSmokePolicy: "inherit_config",
};

test("remote-ready admission rejects missing and hostile smoke results", () => {
  const missing = validateRemoteExecTargets({
    mode: "remote",
    remoteSystem: "x86_64-linux",
    targets: [base],
  });
  assert.match(missing.map((item) => item.message).join("\n"), /admitted remote-builder smoke/);
  const hostile: any = structuredClone(remoteBuilderSmokeEvidence);
  hostile.effectivePolicy.sandboxFallback = true;
  const invalid = validateRemoteExecTargets({
    mode: "remote",
    remoteSystem: "x86_64-linux",
    testOnlyRemoteBuilderSmokeEvidence: hostile,
    targets: [base],
  });
  assert.match(invalid.map((item) => item.message).join("\n"), /sandbox-fallback=false/);
});

test("saved smoke reports are audit evidence, not reusable admission credentials", () => {
  const findings = validateRemoteExecTargets({
    mode: "remote",
    remoteSystem: "x86_64-linux",
    targets: [{ ...base, remoteBuilderSmokeEvidence }],
  });
  assert.match(findings.map((item) => item.message).join("\n"), /active admission invocation/);
});
