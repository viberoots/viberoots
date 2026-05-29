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
            "//pkg:t": { labels: ["remote:ready"], "buck.type": "go_nix_test" },
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
    labels: ["remote:ready"],
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
