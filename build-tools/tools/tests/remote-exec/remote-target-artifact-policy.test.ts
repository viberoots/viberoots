#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertVerifyRemoteTargetsAllowed,
  collectRemoteExecTargetMetadata,
} from "../../dev/verify/remote-target-policy";
import type { VerifyExecutionPolicy } from "../../dev/verify/remote-policy";

const remotePolicy: VerifyExecutionPolicy = {
  mode: "remote",
  buckConfig: "/tmp/remote.buckconfig",
  system: "x86_64-linux",
  artifactDir: "/tmp/artifacts",
  activationDir: "/tmp/activation",
  profilePrefix: "linux-x86_64",
  passProfiles: {},
};

function fakeBuck(providerText: string) {
  return (args: string[]) =>
    args.includes("cquery")
      ? {
          status: 0,
          stdout: JSON.stringify({
            "//pkg:t": {
              labels: [
                "remote:ready",
                "nix-builder:inherit_config",
                "remote-builder-smoke:inherit_config",
              ],
              "buck.type": "zx_test",
            },
          }),
          stderr: "",
        }
      : { status: 0, stdout: providerText, stderr: "" };
}

function metadataForProvider(provider: string) {
  return collectRemoteExecTargetMetadata({
    root: "/repo",
    iso: "iso",
    executionPolicy: remotePolicy,
    targets: [{ target: "//pkg:t", labels: ["remote:ready"] }],
    runBuck: fakeBuck(provider),
  });
}

test("remote target metadata detects undeclared exact and nested local artifact writes", () => {
  for (const [fragment, expected] of [
    ["/tmp", "/tmp"],
    ["/tmp/out", "/tmp"],
    ["coverage", "coverage"],
    ["coverage/raw", "coverage"],
  ] as const) {
    const provider = `ExternalRunnerTestInfo(command=[cmd_args("runner", hidden=[<source helper.ts>]), "${fragment}"], env=None, run_from_project_root=True, use_project_relative_paths=True, local_resources={}, required_local_resources=[])`;
    assert.deepEqual(metadataForProvider(provider)[0]?.undeclaredLocalArtifactPaths, [expected]);
  }
});

test("remote target policy rejects undeclared local artifact writes", () => {
  const provider =
    'ExternalRunnerTestInfo(command=[cmd_args("runner", hidden=[<source helper.ts>]), "/tmp/out"], env=None, run_from_project_root=True, use_project_relative_paths=True, local_resources={}, required_local_resources=[])';
  const metadata = collectRemoteExecTargetMetadata({
    root: "/repo",
    iso: "iso",
    executionPolicy: remotePolicy,
    targets: [{ target: "//pkg:t", labels: ["remote:ready"] }],
    runBuck: fakeBuck(provider),
  });

  assert.deepEqual(metadata[0]?.undeclaredLocalArtifactPaths, ["/tmp"]);
  assert.throws(
    () =>
      assertVerifyRemoteTargetsAllowed({
        root: "/repo",
        iso: "iso",
        executionPolicy: remotePolicy,
        targets: [{ target: "//pkg:t", labels: ["remote:ready"] }],
        runBuck: fakeBuck(provider),
      }),
    /artifact writes require declared outputs/,
  );
});

test("remote target metadata recognizes declared artifact contract labels", () => {
  const provider =
    'ExternalRunnerTestInfo(command=[cmd_args("runner", hidden=[<source helper.ts>]), "buck-out/log"], env=None, labels=["artifact-contract:declared"], run_from_project_root=True, use_project_relative_paths=True, local_resources={}, required_local_resources=[])';
  const metadata = collectRemoteExecTargetMetadata({
    root: "/repo",
    iso: "iso",
    executionPolicy: remotePolicy,
    targets: [{ target: "//pkg:t", labels: ["remote:ready"] }],
    runBuck: fakeBuck(provider),
  });

  assert.equal(metadata[0]?.declaredArtifactContract, true);
  assert.deepEqual(metadata[0]?.undeclaredLocalArtifactPaths, ["buck-out"]);
});
