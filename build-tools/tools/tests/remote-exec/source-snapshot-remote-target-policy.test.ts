#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  admitVerifyRemoteTargets,
  assertVerifyRemoteTargetsAllowed,
  collectRemoteExecTargetMetadata,
} from "../../dev/verify/remote-target-policy";
import type { VerifyExecutionPolicy } from "../../dev/verify/remote-policy";
import { remoteBuilderSmokeEvidence } from "./remote-builder-smoke-test-fixture";

const remotePolicy: VerifyExecutionPolicy = {
  mode: "remote",
  buckConfig: "/tmp/remote.buckconfig",
  system: "x86_64-linux",
  artifactDir: "/tmp/artifacts",
  activationDir: "/tmp/activation",
  profilePrefix: "linux-x86_64",
  passProfiles: {},
  remoteSmoke: {
    remoteCiTools: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-remote-ci-tools",
    transportFile: "/tmp/remote-builder-transport.json",
    probeFlake: "/nix/store/cccccccccccccccccccccccccccccccc-remote-probe-flake",
    builderIdentity: "builder-x86-linux",
    reviewedBuilders: "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-reviewed-builders/registry.json",
    reportPath: "/tmp/artifacts/remote-builder-smoke.json",
  },
};
const smokePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "wrapper-fixtures/remote-builder-smoke.json",
);

test("remote target policy requires same-invocation smoke before accepting declared snapshots", async () => {
  const opts: Parameters<typeof collectRemoteExecTargetMetadata>[0] = {
    root: "/repo",
    iso: "iso",
    executionPolicy: remotePolicy,
    targets: [{ target: "//pkg:t", labels: ["remote:ready"] }],
    runBuck: (args) =>
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
                "buck.type": "go_nix_test",
              },
            }),
            stderr: "",
          }
        : {
            status: 0,
            stdout: `NixRemoteActionPolicyInfo(remote_builder_smoke_path=<source ${smokePath}>) ExternalRunnerTestInfo(command=[cmd_args("runner", hidden=[<source helper.ts>]), "$WORKSPACE_ROOT/viberoots/build-tools/tools/dev/build-selected.ts"], env=None, labels=["source-snapshot:declared-root", "source-snapshot:manifest", "source-snapshot:graph"], run_from_project_root=True, use_project_relative_paths=True, local_resources={}, required_local_resources=[])`,
            stderr: "",
          },
  };
  const metadata = collectRemoteExecTargetMetadata(opts);

  assert.equal(metadata[0]?.requiresWorkspaceRootLookup, true);
  assert.equal(metadata[0]?.sourceSnapshotRootDeclared, true);
  assert.equal(metadata[0]?.sourceSnapshotManifestDeclared, true);
  assert.equal(metadata[0]?.declaredGraphPath, true);
  assert.throws(
    () => assertVerifyRemoteTargetsAllowed(opts),
    /remote builder smoke must run in the active admission invocation/,
  );
  let smokeCalls = 0;
  await admitVerifyRemoteTargets({
    ...opts,
    testOnlyRunRemoteBuilderSmoke: async (smoke) => {
      smokeCalls++;
      assert.equal(smoke.policy, "inherit_config");
      assert.equal(smoke.expectedSystem, "x86_64-linux");
      assert.equal(smoke.builderIdentity, "builder-x86-linux");
      return remoteBuilderSmokeEvidence as never;
    },
  });
  assert.equal(smokeCalls, 1);
});
