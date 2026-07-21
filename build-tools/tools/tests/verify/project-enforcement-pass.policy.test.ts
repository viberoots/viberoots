#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planVerifyTargetPasses,
  VERIFY_PROJECT_ENFORCEMENT_LABEL,
} from "../../dev/verify/target-passes";
import { groupVerifyPassesForExecution } from "../../dev/verify/verify-pass-scheduling";
import {
  buckTestArgsForExecutionPolicy,
  executionPolicyForVerifyPass,
  parseVerifyExecutionPolicy,
} from "../../dev/verify/remote-policy";

test("project enforcement is an earliest local cache-disabled sidecar", () => {
  const passes = planVerifyTargetPasses([
    { target: "//:isolated", labels: ["verify:isolated"] },
    {
      target: "workspace_buck//:project_enforcement_stale_names",
      labels: [VERIFY_PROJECT_ENFORCEMENT_LABEL],
    },
    { target: "//:shared", labels: [] },
  ]);
  assert.deepEqual(
    groupVerifyPassesForExecution(passes).map((group) => group.map((pass) => pass.name)),
    [["isolated", "project-enforcement"], ["shared"]],
  );
  const remote = parseVerifyExecutionPolicy({
    env: {
      VBR_REMOTE_EXEC_MODE: "remote",
      VBR_REMOTE_EXEC_SYSTEM: "aarch64-darwin",
      VBR_REMOTE_BUCK_CONFIG: "/tmp/remote.buckconfig",
      VBR_REMOTE_ARTIFACT_DIR: "/tmp/artifacts",
      VBR_REMOTE_TEST_ACTIVATION_DIR: "/tmp/activation",
      VBR_REMOTE_CI_TOOLS: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-remote-ci-tools",
      VBR_REMOTE_BUILDER_URI: "ssh-ng://builder",
      VBR_REMOTE_PROBE_FLAKE: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-probe-flake",
      VBR_REMOTE_BUILDER_IDENTITY: "builder",
      VBR_REMOTE_REVIEWED_BUILDERS:
        "/nix/store/cccccccccccccccccccccccccccccccc-reviewed-builders/registry.json",
    },
  });
  const local = executionPolicyForVerifyPass(remote, "project-enforcement");
  assert.equal(local.mode, "local");
  assert.deepEqual(buckTestArgsForExecutionPolicy(local, "project-enforcement"), [
    "--local-only",
    "--no-remote-cache",
  ]);
  assert.equal(executionPolicyForVerifyPass(remote, "shared"), remote);
  assert.throws(
    () =>
      planVerifyTargetPasses([
        { target: "//:bad", labels: [VERIFY_PROJECT_ENFORCEMENT_LABEL, "verify:enforcement"] },
      ]),
    /conflicting labels/,
  );
});
