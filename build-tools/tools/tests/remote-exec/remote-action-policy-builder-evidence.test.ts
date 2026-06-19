#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const probeDefs = `
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "remote_action_policy")

def policy_probe(name, evidence):
    remote_action_policy(mode = "remote-ready", evidence = evidence)
    native.filegroup(name = name, srcs = [])
`;

async function assertPolicyFails(args: { name: string; targetBody: string; message: RegExp }) {
  await runInTemp(args.name, async (tmp, $) => {
    const defs = path.join(tmp, "tmp", "policy_defs");
    const dir = path.join(tmp, "tmp", "policy_boolean");
    await fs.mkdir(defs, { recursive: true });
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(defs, "defs.bzl"), probeDefs, "utf8");
    await fs.writeFile(path.join(defs, "TARGETS"), "", "utf8");
    await fs.writeFile(
      path.join(dir, "TARGETS"),
      'load("//tmp/policy_defs:defs.bzl", "policy_probe")\n' + args.targetBody + "\n",
      "utf8",
    );

    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${inheritedBuckIsolation(args.name)} cquery //tmp/policy_boolean:t`;
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), args.message);
  });
}

test("remote action policy rejects boolean builder evidence", async () => {
  await assertPolicyFails({
    name: "remote-boolean-builder-evidence",
    targetBody:
      'policy_probe(name = "t", evidence = {"source_snapshot": {"declared_root": "snapshot", "manifest": "snapshot.manifest.json", "graph_path": "snapshot/.viberoots/workspace/buck/graph.json"}, "materialization_manifest": {"path": "materialization-manifest.json"}, "artifact_contract": {"path": "artifact-contract.json"}, "builder_policy": True, "remote_builder_smoke": {"builder_policy": "inherit_config", "path": "remote-builder-smoke.json"}, "tool_closure": {"path": "tool-closure.json"}, "remote_profile_compatibility": True})',
    message: /typed builder_policy evidence/,
  });
});

test("remote action policy rejects boolean remote-builder smoke evidence", async () => {
  await assertPolicyFails({
    name: "remote-boolean-smoke-evidence",
    targetBody:
      'policy_probe(name = "t", evidence = {"source_snapshot": {"declared_root": "snapshot", "manifest": "snapshot.manifest.json", "graph_path": "snapshot/.viberoots/workspace/buck/graph.json"}, "materialization_manifest": {"path": "materialization-manifest.json"}, "artifact_contract": {"path": "artifact-contract.json"}, "builder_policy": "inherit_config", "remote_builder_smoke": True, "tool_closure": {"path": "tool-closure.json"}, "remote_profile_compatibility": True})',
    message: /typed remote_builder_smoke evidence/,
  });
});
