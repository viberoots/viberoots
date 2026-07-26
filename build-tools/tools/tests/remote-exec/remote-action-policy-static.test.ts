#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const actionFiles = [
  "viberoots/build-tools/go/private/nix_build.bzl",
  "viberoots/build-tools/go/private/nix_build_carchive.bzl",
  "viberoots/build-tools/go/private/nix_build_wasm.bzl",
  "viberoots/build-tools/python/private/nix_build.bzl",
  "viberoots/build-tools/cpp/private/nix_build.bzl",
  "viberoots/build-tools/rust/private/nix_build.bzl",
];

const testStampFiles = [
  "viberoots/build-tools/go/private/nix_test.bzl",
  "viberoots/build-tools/python/private/nix_test.bzl",
  "viberoots/build-tools/cpp/private/nix_test.bzl",
  "viberoots/build-tools/node/private/nix_test.bzl",
  "viberoots/build-tools/rust/private/nix_test.bzl",
  "viberoots/build-tools/tools/buck/zx_test.bzl",
];

const nodeWrappers = [
  "viberoots/build-tools/node/defs_core.bzl",
  "viberoots/build-tools/node/defs_nix.bzl",
  "viberoots/build-tools/node/defs_stage.bzl",
  "viberoots/build-tools/node/defs_service.bzl",
  "viberoots/build-tools/node/defs_vercel.bzl",
];

const sharedNixHelpers = [
  "viberoots/build-tools/lang/nix_shell.bzl",
  "viberoots/build-tools/lang/nix_action_runner.bzl",
];

const externalRunnerWrappers = [
  "viberoots/build-tools/go/private/nix_test.bzl",
  "viberoots/build-tools/python/private/nix_test.bzl",
  "viberoots/build-tools/cpp/private/nix_test.bzl",
  "viberoots/build-tools/node/private/nix_test.bzl",
  "viberoots/build-tools/tools/buck/zx_test.bzl",
];

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function occurrences(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length || 0;
}

test("Nix-backed action rules use the shared remote action policy helper", () => {
  for (const file of actionFiles) {
    const text = read(file);
    assert.match(text, /remote_action_policy\.bzl/, file);
    assert.match(text, /run_nix_action\(/, file);
    assert.doesNotMatch(text, /ctx\.actions\.run\(/, file);
  }
});

test("Rust build and test readiness is bound to the complete declared evidence set", () => {
  for (const file of [
    "viberoots/build-tools/rust/private/nix_build.bzl",
    "viberoots/build-tools/rust/private/nix_test.bzl",
  ]) {
    const text = read(file);
    assert.match(text, /remote_ready_evidence\(/, file);
    for (const field of [
      "source_snapshot",
      "source_snapshot_manifest",
      "materialization_manifest",
      "artifact_contract",
      "tool_closure",
      "remote_builder_smoke",
    ]) {
      assert.match(text, new RegExp(`ctx\\.attrs\\.${field}`), `${file}: ${field}`);
    }
    assert.match(text, /mode = (policy_mode|"remote-ready" if remote_requested)/, file);
  }
});

test("Rust builds switch graph and workspace authority to the declared source snapshot", () => {
  const text = read("viberoots/build-tools/rust/private/nix_build.bzl");
  assert.match(text, /SourceSnapshotInfo/);
  assert.match(text, /source_snapshot_bundle cannot be combined/);
  assert.match(
    text,
    /nix_calling_env_export_source_snapshot\(snapshot_root = "\$\{2:-\}", manifest_path = "\$\{3:-\}"\)/,
  );
  assert.match(
    text,
    /nix_calling_env_materialize_source_snapshot_for_execution\([\s\S]*?snapshot_root = "\$\{2:-\}"/,
  );
  assert.match(text, /graph_json_arg = "\$\{BUCK_GRAPH_JSON:-\$1\}"/);
  assert.match(text, /snapshot_args = \[source_snapshot or "", source_snapshot_manifest or ""\]/);
});

test("Rust remote-ready tests execute the real selected-build harness from the snapshot", () => {
  const text = read("viberoots/build-tools/rust/private/nix_test.bzl");
  assert.match(text, /ctx\.actions\.write\(/);
  assert.match(text, /remote_runner/);
  assert.match(text, /remote_command = \[remote_runner,/);
  assert.match(text, /nix_calling_env_materialize_source_snapshot_for_execution/);
  assert.match(text, /source_snapshot_validator/);
  assert.doesNotMatch(text, /remote_command = \[ctx\.attrs\.remote_ready_runner\]/);
});

test("test wrapper default outputs use deterministic policy stamps", () => {
  for (const file of testStampFiles) {
    const text = read(file);
    assert.match(text, /remote_action_policy\.bzl/, file);
    assert.match(text, /write_nix_test_stamp\(/, file);
    assert.doesNotMatch(text, /run_nix_action\(/, file);
    assert.doesNotMatch(text, /ctx\.actions\.run\(/, file);
    assert.doesNotMatch(text, /category = ".*_test_stamp"/, file);
    assert.doesNotMatch(text, /echo .*_test >/, file);
  }

  const policyText = read("viberoots/build-tools/lang/remote_action_policy.bzl");
  assert.match(policyText, /def write_nix_test_stamp/);
  assert.match(policyText, /ctx\.actions\.write\(output, content\)/);
  assert.match(policyText, /NixRemoteActionPolicyInfo/);
});

test("shared action policy stamps local-only, hybrid, and remote-ready metadata", () => {
  const text = read("viberoots/build-tools/lang/remote_action_policy.bzl");
  assert.match(text, /uses_local_filesystem_abspaths/);
  assert.match(text, /remote-action-policy:local-only/);
  assert.match(text, /remote-action-policy:hybrid/);
  assert.match(text, /remote-action-policy:remote-ready/);
  assert.match(text, /source_snapshot/);
  assert.match(text, /declared_root/);
  assert.match(text, /graph_path/);
  assert.match(text, /materialization_manifest/);
  assert.match(text, /artifact_contract/);
  assert.match(text, /tool_closure/);
  assert.match(text, /builder_policy/);
  assert.match(text, /remote_builder_smoke/);
  assert.match(text, /remote_profile_compatibility/);
  assert.match(text, /fallback_reason/);
});

test("remote-ready external-runner commands carry declared input handles", () => {
  const policyText = read("viberoots/build-tools/lang/remote_action_policy.bzl");
  assert.match(policyText, /def external_runner_command/);
  assert.match(policyText, /REMOTE_READY/);
  assert.match(policyText, /requires declared inputs/);
  assert.match(policyText, /missing required declared inputs/);
  assert.match(policyText, /requires a separate declared remote command/);
  assert.match(policyText, /contains local workspace\/bootstrap fragments/);
  assert.match(policyText, /cmd_args\(remote_command\[0\], hidden = declared_inputs\)/);
  for (const file of externalRunnerWrappers) {
    const text = read(file);
    assert.match(text, /external_runner_command\(/, file);
    assert.match(text, /declared_inputs = /, file);
    assert.match(text, /source_snapshot/, file);
    assert.match(text, /source-snapshot:declared-root/, file);
    assert.match(
      text,
      /remote_command = \[ctx\.attrs\.remote_ready_runner\] \+ snapshot_inputs/,
      file,
    );
  }
});

test("Node Nix build and stage genrules apply local-only scheduling labels", () => {
  for (const file of nodeWrappers) {
    const text = read(file);
    assert.match(text, /stamp_local_only_genrule_labels/, file);
    assert.equal(
      occurrences(text, /genrule\(\*\*kw\)|genrule\(\*\*planner_kw\)/g),
      occurrences(text, /stamp_local_only_genrule_labels\(/g),
      file,
    );
  }
});

test("shared Nix helpers do not own unscheduled Buck actions", () => {
  for (const file of sharedNixHelpers) {
    const text = read(file);
    assert.doesNotMatch(text, /ctx\.actions\.run\(/, file);
    assert.doesNotMatch(text, /genrule\(/, file);
  }
  assert.match(
    read("viberoots/build-tools/lang/language_wiring.bzl"),
    /stamp_remote_readiness_labels/,
  );
});
