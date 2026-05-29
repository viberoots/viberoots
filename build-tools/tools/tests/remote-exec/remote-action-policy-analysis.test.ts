#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const probeDefs = `
load("//build-tools/lang:remote_action_policy.bzl", "external_runner_command", "remote_action_policy")

def policy_probe(name, mode = "local-only", evidence = None, fallback_reason = None):
    remote_action_policy(
        mode = mode,
        evidence = evidence,
        fallback_reason = fallback_reason,
    )
    native.filegroup(name = name, srcs = [])

def command_probe(ctx):
    labels = ["remote:ready"] if ctx.attrs.remote_ready else []
    external_runner_command(
        labels,
        ["bash", "-c", "echo ok"],
        remote_command = [ctx.attrs.remote_runner],
        declared_inputs = ctx.attrs.declared_inputs,
        required_inputs = ctx.attrs.required_inputs,
    )
    return [DefaultInfo()]

command_probe_rule = rule(
    impl = command_probe,
    attrs = {
        "declared_inputs": attrs.list(attrs.source(), default = []),
        "remote_ready": attrs.bool(default = False),
        "remote_runner": attrs.source(),
        "required_inputs": attrs.list(attrs.source(), default = []),
    },
)
`;

const validTargets = `
load("//tmp/policy_defs:defs.bzl", "policy_probe")

policy_probe(name = "local")
policy_probe(
    name = "remote_ready",
    mode = "remote-ready",
    evidence = {
        "source_snapshot": {"declared_root": "snapshot", "manifest": "snapshot.manifest.json", "graph_path": "snapshot/build-tools/tools/buck/graph.json"},
        "materialization_manifest": True,
        "artifact_contract": True,
        "builder_policy": "inherit_config",
        "remote_builder_smoke": "inherit_config",
        "remote_profile_compatibility": True,
    },
)
`;

test("remote action policy rejects remote-ready and hybrid actions without evidence", async () => {
  await runInTemp("remote-action-policy-analysis", async (tmp, $) => {
    const defs = path.join(tmp, "tmp", "policy_defs");
    const valid = path.join(tmp, "tmp", "policy_valid");
    const missingDir = path.join(tmp, "tmp", "policy_missing");
    const hybridDir = path.join(tmp, "tmp", "policy_hybrid");
    for (const dir of [defs, valid, missingDir, hybridDir])
      await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(defs, "defs.bzl"), probeDefs, "utf8");
    await fs.writeFile(path.join(defs, "TARGETS"), "", "utf8");
    await fs.writeFile(
      path.join(missingDir, "TARGETS"),
      'load("//tmp/policy_defs:defs.bzl", "policy_probe")\npolicy_probe(name = "t", mode = "remote-ready")\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(hybridDir, "TARGETS"),
      'load("//tmp/policy_defs:defs.bzl", "policy_probe")\npolicy_probe(name = "t", mode = "hybrid", evidence = {"source_snapshot": {"declared_root": "snapshot", "manifest": "snapshot.manifest.json", "graph_path": "snapshot/build-tools/tools/buck/graph.json"}, "materialization_manifest": True, "artifact_contract": True, "builder_policy": "inherit_config", "remote_builder_smoke": "inherit_config", "remote_profile_compatibility": True})\n',
      "utf8",
    );
    await fs.writeFile(path.join(valid, "TARGETS"), validTargets, "utf8");

    const ok = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_action_policy_analysis")} cquery //tmp/policy_valid:remote_ready`;
    assert.equal(ok.exitCode, 0, String(ok.stderr || ""));

    const missing = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_action_policy_analysis")} cquery //tmp/policy_missing:t`;
    assert.notEqual(missing.exitCode, 0);
    assert.match(String(missing.stderr || ""), /source_snapshot/);
    assert.match(String(missing.stderr || ""), /remote_profile_compatibility/);

    const hybrid = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_action_policy_analysis")} cquery //tmp/policy_hybrid:t`;
    assert.notEqual(hybrid.exitCode, 0);
    assert.match(String(hybrid.stderr || ""), /fallback_reason/);
  });
});

test("remote action policy rejects local-only Nix builder evidence", async () => {
  await runInTemp("remote-action-policy-builder-policy", async (tmp, $) => {
    const defs = path.join(tmp, "tmp", "policy_defs");
    const dir = path.join(tmp, "tmp", "policy_builder");
    await fs.mkdir(defs, { recursive: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(defs, "defs.bzl"), probeDefs, "utf8");
    await fs.writeFile(path.join(defs, "TARGETS"), "", "utf8");
    await fs.writeFile(
      path.join(dir, "TARGETS"),
      'load("//tmp/policy_defs:defs.bzl", "policy_probe")\npolicy_probe(name = "t", mode = "remote-ready", evidence = {"source_snapshot": {"declared_root": "snapshot", "manifest": "snapshot.manifest.json", "graph_path": "snapshot/build-tools/tools/buck/graph.json"}, "materialization_manifest": True, "artifact_contract": True, "builder_policy": "local_only", "remote_builder_smoke": True, "remote_profile_compatibility": True})\n',
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_builder_policy_analysis")} cquery //tmp/policy_builder:t`;
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /local_only Nix builder policy/);
  });
});

test("remote action policy requires builder smoke to match selected policy", async () => {
  await runInTemp("remote-action-policy-builder-smoke-match", async (tmp, $) => {
    const defs = path.join(tmp, "tmp", "policy_defs");
    const dir = path.join(tmp, "tmp", "policy_builder_smoke");
    await fs.mkdir(defs, { recursive: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(defs, "defs.bzl"), probeDefs, "utf8");
    await fs.writeFile(path.join(defs, "TARGETS"), "", "utf8");
    await fs.writeFile(
      path.join(dir, "TARGETS"),
      'load("//tmp/policy_defs:defs.bzl", "policy_probe")\npolicy_probe(name = "t", mode = "remote-ready", evidence = {"source_snapshot": {"declared_root": "snapshot", "manifest": "snapshot.manifest.json", "graph_path": "snapshot/build-tools/tools/buck/graph.json"}, "materialization_manifest": True, "artifact_contract": True, "builder_policy": "inherit_config", "remote_builder_smoke": "force_builders_file", "remote_profile_compatibility": True})\n',
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_builder_smoke_match")} cquery //tmp/policy_builder_smoke:t`;
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /matching remote_builder_smoke evidence/);
  });
});

test("remote-ready external-runner command policy requires declared handles", async () => {
  await runInTemp("remote-command-policy-analysis", async (tmp, $) => {
    const defs = path.join(tmp, "tmp", "policy_defs");
    const commandDir = path.join(tmp, "tmp", "command_policy");
    await fs.mkdir(defs, { recursive: true });
    await fs.mkdir(commandDir, { recursive: true });
    await fs.writeFile(path.join(defs, "defs.bzl"), probeDefs, "utf8");
    await fs.writeFile(path.join(defs, "TARGETS"), "", "utf8");
    await fs.writeFile(path.join(commandDir, "helper.txt"), "helper\n", "utf8");
    await fs.writeFile(path.join(commandDir, "runner.txt"), "runner\n", "utf8");
    await fs.writeFile(
      path.join(commandDir, "TARGETS"),
      [
        'load("//tmp/policy_defs:defs.bzl", "command_probe_rule")',
        'command_probe_rule(name = "local_no_inputs", remote_runner = "runner.txt")',
        'command_probe_rule(name = "ready_no_inputs", remote_ready = True, remote_runner = "runner.txt")',
        'command_probe_rule(name = "ready_missing_required", remote_ready = True, remote_runner = "runner.txt", declared_inputs = ["helper.txt"], required_inputs = ["missing.txt"])',
        'command_probe_rule(name = "ready_ok", remote_ready = True, remote_runner = "runner.txt", declared_inputs = ["helper.txt"], required_inputs = ["helper.txt"])',
      ].join("\n") + "\n",
      "utf8",
    );
    await fs.writeFile(path.join(commandDir, "missing.txt"), "missing\n", "utf8");

    const ok = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_command_policy_analysis")} audit providers //tmp/command_policy:ready_ok`;
    assert.equal(ok.exitCode, 0, String(ok.stderr || ""));

    const local = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_command_policy_analysis")} audit providers //tmp/command_policy:local_no_inputs`;
    assert.equal(local.exitCode, 0, String(local.stderr || ""));

    const noInputs = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_command_policy_analysis")} audit providers //tmp/command_policy:ready_no_inputs`;
    assert.notEqual(noInputs.exitCode, 0);
    assert.match(String(noInputs.stderr || ""), /requires declared inputs/);

    const missing = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation("remote_command_policy_analysis")} audit providers //tmp/command_policy:ready_missing_required`;
    assert.notEqual(missing.exitCode, 0);
    assert.match(String(missing.stderr || ""), /missing required declared inputs/);
  });
});
