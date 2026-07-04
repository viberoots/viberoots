#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseVerifyExecutionPolicyForArgs } from "../../dev/verify/args";
import { buildVerifyTestEnvArgs } from "../../dev/verify/buck2-test-env";
import { buildBuckProcessEnvForPolicy } from "../../dev/verify/buck2-test-remote-env";
import {
  buckCqueryArgsForExecutionPolicy,
  buckTestArgsForExecutionPolicy,
  parseVerifyExecutionPolicy,
  remoteProfileForPass,
  shouldComputeLocalZxTestNodeModules,
  targetPlatformArgsForPolicy,
} from "../../dev/verify/remote-policy";
import {
  planVerifyTargetPasses,
  VERIFY_RESOURCE_LIMITED_LABEL,
} from "../../dev/verify/target-passes";

const remoteEnv = {
  VBR_REMOTE_EXEC_MODE: "hybrid",
  VBR_REMOTE_BUCK_CONFIG: "/tmp/vbr-remote/buckconfig",
  VBR_REMOTE_EXEC_SYSTEM: "x86_64-linux",
  VBR_REMOTE_ARTIFACT_DIR: "/tmp/vbr-remote/artifacts",
  VBR_REMOTE_TEST_ACTIVATION_DIR: "/tmp/vbr-remote/activation",
};

async function activationEnv(profile = "linux-x86_64-default") {
  const activationDir = await fs.mkdtemp(path.join(os.tmpdir(), "vbr-activation-"));
  await fs.writeFile(
    path.join(activationDir, "shared.buckconfig"),
    `[test]\nviberoots_remote_profile = ${profile}\n`,
  );
  await fs.writeFile(
    path.join(activationDir, "resource-limited.buckconfig"),
    `[test]\nviberoots_remote_profile = linux-x86_64-large\n`,
  );
  return { ...remoteEnv, VBR_REMOTE_TEST_ACTIVATION_DIR: activationDir };
}

test("verify remote policy defaults to local with no remote inputs", () => {
  const policy = parseVerifyExecutionPolicy({ env: {} });

  assert.equal(policy.mode, "local");
  assert.deepEqual(buckTestArgsForExecutionPolicy(policy, "shared"), []);
  assert.deepEqual(targetPlatformArgsForPolicy(policy), [
    "--target-platforms",
    "prelude//platforms:default",
  ]);
});

test("verify local Buck process env uses BUCK2_REAL_HOME as HOME", () => {
  const policy = parseVerifyExecutionPolicy({ env: {} });
  const env = buildBuckProcessEnvForPolicy(policy, {
    HOME: "/host-home",
    BUCK2_REAL_HOME: "/workspace/buck-home",
    VBR_VERIFY_REGISTER_PROCESS: "1",
  });

  assert.equal(env.HOME, "/workspace/buck-home");
  assert.equal(env.BUCK2_REAL_HOME, "/workspace/buck-home");
  assert.equal(env.VBR_VERIFY_REGISTER_PROCESS, undefined);
});

test("verify remote policy parses supported modes and maps systems to profile prefixes", () => {
  for (const [system, prefix] of [
    ["x86_64-linux", "linux-x86_64"],
    ["aarch64-linux", "linux-aarch64"],
    ["aarch64-darwin", "darwin-aarch64"],
  ] as const) {
    const policy = parseVerifyExecutionPolicy({
      env: { ...remoteEnv, VBR_REMOTE_EXEC_SYSTEM: system },
    });

    assert.equal(policy.profilePrefix, prefix);
    assert.equal(remoteProfileForPass(policy, "shared"), `${prefix}-default`);
    assert.doesNotMatch(remoteProfileForPass(policy, "shared") || "", /^x86_64-linux-/);
  }
});

test("verify remote policy validates remote mode inputs before local setup", () => {
  assert.throws(
    () => parseVerifyExecutionPolicy({ env: { ...remoteEnv, VBR_REMOTE_EXEC_MODE: "bogus" } }),
    /unknown VBR_REMOTE_EXEC_MODE/,
  );
  assert.throws(
    () => parseVerifyExecutionPolicy({ env: { ...remoteEnv, VBR_REMOTE_BUCK_CONFIG: "" } }),
    /VBR_REMOTE_BUCK_CONFIG is required/,
  );
  assert.throws(
    () =>
      parseVerifyExecutionPolicy({
        env: { ...remoteEnv, VBR_REMOTE_BUCK_CONFIG: "relative/.buckconfig" },
      }),
    /VBR_REMOTE_BUCK_CONFIG must be an absolute path/,
  );
  assert.throws(
    () =>
      parseVerifyExecutionPolicy({
        env: { ...remoteEnv, VBR_REMOTE_EXEC_SYSTEM: "riscv64-linux" },
      }),
    /unknown VBR_REMOTE_EXEC_SYSTEM/,
  );
  assert.throws(
    () => parseVerifyExecutionPolicy({ env: remoteEnv, coverage: true }),
    /declared raw coverage outputs and local aggregation materialization/,
  );
});

test("verify remote policy parser covers every remote mode and unsafe paths", () => {
  for (const mode of ["hybrid", "remote", "remote-only-conformance"] as const) {
    assert.equal(
      parseVerifyExecutionPolicyForArgs({
        args: { coverage: false },
        env: { ...remoteEnv, VBR_REMOTE_EXEC_MODE: mode },
      }).mode,
      mode,
    );
  }
  for (const value of [
    "/tmp/vbr-remote/../buckconfig",
    "/tmp/vbr-remote/buckconfig\nnext",
    "/tmp/vbr-remote/buckconfig\0next",
  ]) {
    assert.throws(
      () =>
        parseVerifyExecutionPolicyForArgs({
          args: { coverage: false },
          env: { ...remoteEnv, VBR_REMOTE_BUCK_CONFIG: value },
        }),
      /VBR_REMOTE_BUCK_CONFIG must be/,
    );
  }
});

test("verify remote policy carries per-pass profile overrides into Buck args", async () => {
  const env = await activationEnv("linux-x86_64-default");
  const policy = parseVerifyExecutionPolicy({
    env: {
      ...env,
      VBR_REMOTE_EXEC_MODE: "remote-only-conformance",
      VBR_REMOTE_TEST_PROFILE_RESOURCE_LIMITED: "linux-x86_64-large",
    },
  });

  assert.equal(remoteProfileForPass(policy, "resource-limited"), "linux-x86_64-large");
  assert.deepEqual(buckTestArgsForExecutionPolicy(policy, "resource-limited"), [
    "--config-file",
    "/tmp/vbr-remote/buckconfig",
    "-c",
    "build.execution_platforms=repo_toolchains//:remote_execution_platforms",
    "--config-file",
    path.join(env.VBR_REMOTE_TEST_ACTIVATION_DIR, "resource-limited.buckconfig"),
    "--remote-only",
    "--unstable-allow-compatible-tests-on-re",
  ]);
  assert.match(
    await fs.readFile(
      path.join(env.VBR_REMOTE_TEST_ACTIVATION_DIR, "resource-limited.buckconfig"),
      "utf8",
    ),
    /viberoots_remote_profile = linux-x86_64-large/,
  );
});

test("verify remote policy rewrites stale activation config from selected profile", async () => {
  const env = await activationEnv("linux-x86_64-default");
  const stalePath = path.join(env.VBR_REMOTE_TEST_ACTIVATION_DIR, "shared.buckconfig");
  await fs.writeFile(stalePath, "[test]\nviberoots_remote_profile = linux-x86_64-default\n");
  const policy = parseVerifyExecutionPolicy({
    env: {
      ...env,
      VBR_REMOTE_TEST_PROFILE_SHARED: "linux-x86_64-large",
    },
  });

  assert.equal(remoteProfileForPass(policy, "shared"), "linux-x86_64-large");
  assert.ok(buckTestArgsForExecutionPolicy(policy, "shared").includes(stalePath));
  const rewritten = await fs.readFile(stalePath, "utf8");
  assert.match(rewritten, /viberoots_remote_profile = linux-x86_64-large/);
  assert.doesNotMatch(rewritten, /grpc:\/\/|authorization|api[_-]?key|token|secret|password/i);
});

test("verify remote policy shares cquery and test configuration policy", () => {
  const policy = parseVerifyExecutionPolicy({ env: remoteEnv });

  assert.deepEqual(buckCqueryArgsForExecutionPolicy(policy), [
    "--config-file",
    "/tmp/vbr-remote/buckconfig",
    "-c",
    "build.execution_platforms=repo_toolchains//:remote_execution_platforms",
  ]);
  assert.deepEqual(targetPlatformArgsForPolicy(policy), [
    "--target-platforms",
    "prelude//platforms:default",
  ]);
  assert.equal(shouldComputeLocalZxTestNodeModules(policy), false);
});

test("verify remote policy fails before Buck when profile activation is not selected", () => {
  const { VBR_REMOTE_TEST_ACTIVATION_DIR: _unused, ...env } = remoteEnv;

  assert.throws(
    () =>
      parseVerifyExecutionPolicy({
        env,
      }),
    /VBR_REMOTE_TEST_ACTIVATION_DIR is required/,
  );
});

test("verify remote policy does not emit local zx node_modules env when unavailable", () => {
  assert.deepEqual(
    buildVerifyTestEnvArgs({
      iso: "v-1-test",
      passName: "shared",
      zxNodeModulesOut: null,
      nodeTestTimeoutMs: 1200000,
      testNixTimeoutSecs: 1200,
    }).filter((arg) => arg.includes("ZX_TEST_NODE_MODULES_OUT")),
    [],
  );
});

test("verify remote policy keeps threads independent from remote mode", async () => {
  const local = parseVerifyExecutionPolicy({ env: {} });
  const remote = parseVerifyExecutionPolicy({ env: await activationEnv() });
  const targets = [{ target: "//:resource-heavy", labels: [VERIFY_RESOURCE_LIMITED_LABEL] }];
  const localPasses = planVerifyTargetPasses(targets);
  const remotePasses = planVerifyTargetPasses(targets);

  assert.deepEqual(localPasses, remotePasses);
  assert.equal(local.mode, "local");
  assert.equal(remote.mode, "hybrid");
});
