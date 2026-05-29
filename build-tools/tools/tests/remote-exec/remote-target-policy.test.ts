#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { inheritedBuckIsolation } from "../lib/test-helpers";
import {
  assertVerifyRemoteTargetsAllowed,
  collectRemoteExecTargetMetadata,
} from "../../dev/verify/remote-target-policy";
import {
  targetPlatformArgsForPolicy,
  type VerifyExecutionPolicy,
} from "../../dev/verify/remote-policy";

const remotePolicy: VerifyExecutionPolicy = {
  mode: "remote",
  buckConfig: "/tmp/remote.buckconfig",
  system: "x86_64-linux",
  artifactDir: "/tmp/artifacts",
  activationDir: "/tmp/activation",
  profilePrefix: "linux-x86_64",
  passProfiles: {},
};

test("remote target policy collects cquery and provider metadata before Buck test", () => {
  const calls: string[][] = [];
  const metadata = collectRemoteExecTargetMetadata({
    root: "/repo",
    iso: "iso",
    executionPolicy: remotePolicy,
    targets: [{ target: "//pkg:t", labels: ["remote:ready"] }],
    runBuck: (args) => {
      calls.push(args);
      if (args.includes("cquery")) {
        assert.ok(args.includes("--output-attribute"));
        assert.ok(args.includes("buck.type"));
        return {
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
        };
      }
      assert.deepEqual(args.slice(2, 4), ["audit", "providers"]);
      return {
        status: 0,
        stdout:
          'ExternalRunnerTestInfo(command=[cmd_args("runner", hidden=[<source helper.ts>])], run_from_project_root=True, use_project_relative_paths=True, local_resources={}, required_local_resources=[])',
        stderr: "",
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(metadata[0], {
    target: "//pkg:t",
    ruleFamily: "go_nix_test",
    labels: ["remote:ready", "nix-builder:inherit_config", "remote-builder-smoke:inherit_config"],
    nixBuilderPolicy: "inherit_config",
    remoteBuilderSmokePolicy: "inherit_config",
    runFromProjectRoot: true,
    useProjectRelativePaths: true,
    localResources: [],
    requiredLocalResources: [],
    networkAccess: false,
    commandInputsDeclared: true,
    requiresWorkspaceRootLookup: false,
    ambientPathDependency: false,
  });
});

test("remote target policy extracts builder policy metadata from providers", () => {
  const metadata = collectRemoteExecTargetMetadata({
    root: "/repo",
    iso: "iso",
    executionPolicy: remotePolicy,
    targets: [{ target: "//pkg:t", labels: ["remote:ready"] }],
    runBuck: (args) =>
      args.includes("cquery")
        ? {
            status: 0,
            stdout: JSON.stringify({
              "//pkg:t": { labels: ["remote:ready"], "buck.type": "go_nix_test" },
            }),
            stderr: "",
          }
        : {
            status: 0,
            stdout:
              'DefaultInfo(metadata={"nix_builder_policy": "force_builders_file", "remote_builder_smoke": "force_builders_file"}) ExternalRunnerTestInfo(command=[cmd_args("runner", hidden=[<source helper.ts>])], run_from_project_root=True, use_project_relative_paths=True, local_resources={}, required_local_resources=[])',
            stderr: "",
          },
  });

  assert.equal(metadata[0]?.nixBuilderPolicy, "force_builders_file");
  assert.equal(metadata[0]?.remoteBuilderSmokePolicy, "force_builders_file");
});

test("remote target policy preserves malformed builder evidence for validation", () => {
  const opts: Parameters<typeof collectRemoteExecTargetMetadata>[0] = {
    root: "/repo",
    iso: "iso",
    executionPolicy: remotePolicy,
    targets: [{ target: "//pkg:t", labels: ["remote:ready", "nix-builder:true"] }],
    runBuck: (args) =>
      args.includes("cquery")
        ? {
            status: 0,
            stdout: JSON.stringify({
              "//pkg:t": {
                labels: ["remote:ready", "nix-builder:true"],
                "buck.type": "go_nix_test",
              },
            }),
            stderr: "",
          }
        : {
            status: 0,
            stdout:
              'ExternalRunnerTestInfo(command=[cmd_args("runner", hidden=[<source helper.ts>])], run_from_project_root=True, use_project_relative_paths=True, local_resources={}, required_local_resources=[])',
            stderr: "",
          },
  };
  const metadata = collectRemoteExecTargetMetadata(opts);

  assert.equal(metadata[0]?.nixBuilderPolicy, "true");
  assert.throws(() => assertVerifyRemoteTargetsAllowed(opts), /typed Nix builder policy evidence/);
});

test("remote target policy preserves malformed smoke evidence for validation", () => {
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
              "//pkg:t": { labels: ["remote:ready"], "buck.type": "go_nix_test" },
            }),
            stderr: "",
          }
        : {
            status: 0,
            stdout:
              'NixRemoteActionPolicyInfo(builder_policy="inherit_config", remote_builder_smoke=True) ExternalRunnerTestInfo(command=[cmd_args("runner", hidden=[<source helper.ts>])], run_from_project_root=True, use_project_relative_paths=True, local_resources={}, required_local_resources=[])',
            stderr: "",
          },
  };
  const metadata = collectRemoteExecTargetMetadata(opts);

  assert.equal(metadata[0]?.nixBuilderPolicy, "inherit_config");
  assert.equal(metadata[0]?.remoteBuilderSmokePolicy, "True");
  assert.throws(
    () => assertVerifyRemoteTargetsAllowed(opts),
    /typed remote-builder smoke evidence/,
  );
});

test("production remote target assertion rejects unlabeled cquery metadata", () => {
  assert.throws(
    () =>
      assertVerifyRemoteTargetsAllowed({
        root: "/repo",
        iso: "iso",
        executionPolicy: remotePolicy,
        targets: [{ target: "//pkg:t", labels: [] }],
        runBuck: (args) =>
          args.includes("cquery")
            ? {
                status: 0,
                stdout: JSON.stringify({ "//pkg:t": { labels: [], "buck.type": "go_nix_test" } }),
                stderr: "",
              }
            : {
                status: 0,
                stdout:
                  "ExternalRunnerTestInfo(command=[], run_from_project_root=True, use_project_relative_paths=True)",
                stderr: "",
              },
      }),
    /requires explicit remote:ready/,
  );
});

test("production remote target assertion rejects ambient PATH command dependencies", () => {
  assert.throws(
    () =>
      assertVerifyRemoteTargetsAllowed({
        root: "/repo",
        iso: "iso",
        executionPolicy: remotePolicy,
        targets: [{ target: "//pkg:t", labels: ["remote:ready"] }],
        runBuck: (args) =>
          args.includes("cquery")
            ? {
                status: 0,
                stdout: JSON.stringify({
                  "//pkg:t": { labels: ["remote:ready"], "buck.type": "go_nix_test" },
                }),
                stderr: "",
              }
            : {
                status: 0,
                stdout:
                  'ExternalRunnerTestInfo(command=[cmd_args("bash", hidden=[<source helper.ts>]), "-c", "$(command -v node) helper.ts"], env=None, run_from_project_root=True, use_project_relative_paths=True)',
                stderr: "",
              },
      }),
    /ambient PATH/,
  );
});

test("production zx_test provider exposes Nix builder policy metadata", async () => {
  const args = [
    "--isolation-dir",
    inheritedBuckIsolation("remote_target_policy_provider_metadata"),
    "audit",
    "providers",
    ...targetPlatformArgsForPolicy(remotePolicy),
    "//:remote_exec_remote_target_policy",
  ];
  const res = await $({
    stdio: "pipe",
    nothrow: true,
  })`buck2 ${args}`;
  assert.equal(res.exitCode, 0, String(res.stderr || ""));
  const text = String(res.stdout || "");
  assert.match(text, /NixRemoteActionPolicyInfo/);
  assert.match(text, /builder_policy = "local_only"|builder_policy="local_only"/);
  assert.match(text, /nix-builder:local_only/);
});
