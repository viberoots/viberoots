#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buckLogEnvForExecutionPolicy,
  remoteBuckArtifactArgs,
  remoteBuckPolicySummary,
  writeRemoteBuckMaterializationMetadata,
} from "../../dev/verify/remote-buck-artifacts";
import {
  buckTestArgsForExecutionPolicy,
  parseVerifyExecutionPolicy,
} from "../../dev/verify/remote-policy";

const remoteEnv = {
  VBR_REMOTE_ARTIFACT_DIR: "/tmp/vbr-remote/artifacts",
  VBR_REMOTE_BUCK_CONFIG: "/tmp/vbr-remote/buckconfig",
  VBR_REMOTE_EXEC_MODE: "hybrid",
  VBR_REMOTE_EXEC_SYSTEM: "x86_64-linux",
  VBR_REMOTE_TEST_ACTIVATION_DIR: "/tmp/vbr-remote/activation",
  VBR_REMOTE_CI_TOOLS: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-remote-ci-tools",
  VBR_REMOTE_BUILDER_TRANSPORT: "/tmp/remote-builder-transport.json",
  VBR_REMOTE_PROBE_FLAKE: "/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-probe-flake",
  VBR_REMOTE_BUILDER_IDENTITY: "builder",
  VBR_REMOTE_REVIEWED_BUILDERS:
    "/nix/store/cccccccccccccccccccccccccccccccc-reviewed-builders/registry.json",
};

function ensureActivation(passName = "shared"): void {
  fs.mkdirSync(remoteEnv.VBR_REMOTE_TEST_ACTIVATION_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(remoteEnv.VBR_REMOTE_TEST_ACTIVATION_DIR, `${passName}.buckconfig`),
    "[test]\nviberoots_remote_profile = linux-x86_64-default\n",
  );
}

test("remote Buck modes use reviewed execution flags only", () => {
  ensureActivation();
  const modes = [
    ["hybrid", "--prefer-remote"],
    ["remote", "--prefer-remote"],
    ["remote-only-conformance", "--remote-only"],
  ] as const;

  for (const [mode, flag] of modes) {
    const policy = parseVerifyExecutionPolicy({
      env: { ...remoteEnv, VBR_REMOTE_EXEC_MODE: mode },
    });
    const args = buckTestArgsForExecutionPolicy(policy, "shared");
    assert.ok(args.includes(flag));
    assert.ok(args.includes("--unstable-allow-compatible-tests-on-re"));
    assert.equal(args.includes("--unstable-allow-all-tests-on-re"), false);
    assert.equal(args.includes("--remote"), false);
  }
});

test("remote Buck artifacts are deterministic and retention scoped", () => {
  const policy = parseVerifyExecutionPolicy({ env: remoteEnv });

  assert.deepEqual(remoteBuckArtifactArgs(policy, "shared", {}), [
    "--event-log",
    "/tmp/vbr-remote/artifacts/runs/verify/passes/shared/buck-event-log.pb.zst",
    "--build-report",
    "/tmp/vbr-remote/artifacts/runs/verify/passes/shared/buck-build-report.json",
    "--write-build-id",
    "/tmp/vbr-remote/artifacts/runs/verify/passes/shared/buck-build-id.txt",
    "--command-report-path",
    "/tmp/vbr-remote/artifacts/runs/verify/passes/shared/buck-command-report.json",
    "--test-executor-stdout",
    "/tmp/vbr-remote/artifacts/runs/verify/passes/shared/test-executor-stdout.log",
    "--test-executor-stderr",
    "/tmp/vbr-remote/artifacts/runs/verify/passes/shared/test-executor-stderr.log",
  ]);

  assert.deepEqual(
    remoteBuckArtifactArgs(policy, "shared", {
      VBR_REMOTE_MATERIALIZE_FAILED_INPUTS: "1",
      VBR_REMOTE_MATERIALIZE_FAILED_OUTPUTS: "true",
    }).slice(-2),
    ["--materialize-failed-inputs", "--materialize-failed-outputs"],
  );
});

test("remote Buck materialization writes retention metadata under artifact dir", () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "vbr-remote-artifacts-"));
  const policy = parseVerifyExecutionPolicy({
    env: { ...remoteEnv, VBR_REMOTE_ARTIFACT_DIR: artifactDir },
  });

  writeRemoteBuckMaterializationMetadata({
    policy,
    passName: "shared",
    env: {
      VBR_REMOTE_MATERIALIZE_FAILED_INPUTS: "1",
      VBR_REMOTE_MATERIALIZE_FAILED_OUTPUTS: "true",
    },
  });

  const metadata = JSON.parse(
    fs.readFileSync(
      path.join(
        artifactDir,
        "runs",
        "verify",
        "passes",
        "shared",
        "failed-materialization-policy.json",
      ),
      "utf8",
    ),
  );
  assert.equal(metadata.artifactDir, path.join(artifactDir, "runs", "verify", "passes", "shared"));
  assert.deepEqual(metadata.buckFlags, [
    "--materialize-failed-inputs",
    "--materialize-failed-outputs",
  ]);
  assert.equal(metadata.contract.failedInputs.redaction, "sensitive-debug");
  assert.equal(metadata.contract.policy.retention, "debug-on-failure");
  assert.match(metadata.note, /bare failed-materialization flags/);
});

test("remote Buck log env preserves event-log writers", () => {
  const localPolicy = parseVerifyExecutionPolicy({ env: {} });
  const remotePolicy = parseVerifyExecutionPolicy({ env: remoteEnv });

  assert.match(buckLogEnvForExecutionPolicy(localPolicy).RUST_LOG || "", /writer=off/);
  assert.doesNotMatch(buckLogEnvForExecutionPolicy(remotePolicy).RUST_LOG || "", /writer=off/);
  assert.doesNotMatch(buckLogEnvForExecutionPolicy(remotePolicy).BUCK_LOG || "", /writer=off/);
});

test("remote Buck log env strips inherited event-log writer suppression only", () => {
  const remotePolicy = parseVerifyExecutionPolicy({ env: remoteEnv });
  const env = buckLogEnvForExecutionPolicy(remotePolicy, {
    RUST_LOG: "info,buck2_event_log::writer=off,buck2_client_ctx=debug",
    BUCK_LOG: "warn,buck2_event_log::writer=off,buck2_execute=trace",
  });

  assert.equal(env.RUST_LOG, "info,buck2_client_ctx=debug");
  assert.equal(env.BUCK_LOG, "warn,buck2_execute=trace");
});

test("remote Buck policy summary redacts config path and reports fingerprint", () => {
  fs.mkdirSync("/tmp/vbr-remote", { recursive: true });
  fs.writeFileSync("/tmp/vbr-remote/buckconfig", "remote.secret = hidden\n");
  const policy = parseVerifyExecutionPolicy({
    env: {
      ...remoteEnv,
      VBR_REMOTE_TEST_PROFILE_SHARED: "linux-x86_64-large",
    },
  });
  const summary = remoteBuckPolicySummary(policy, "shared") || "";

  assert.match(summary, /profile=linux-x86_64-large/);
  assert.match(summary, /config_fingerprint=sha256:[0-9a-f]{16}/);
  assert.doesNotMatch(summary, /buckconfig/);
  assert.doesNotMatch(summary, /secret|hidden/);
});
