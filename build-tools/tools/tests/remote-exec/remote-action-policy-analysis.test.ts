#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const probeDefs = `
load("//build-tools/lang:remote_action_policy.bzl", "remote_action_policy")

def policy_probe(name, mode = "local-only", evidence = None, fallback_reason = None):
    remote_action_policy(
        mode = mode,
        evidence = evidence,
        fallback_reason = fallback_reason,
    )
    native.filegroup(name = name, srcs = [])
`;

const validTargets = `
load("//tmp/policy_defs:defs.bzl", "policy_probe")

policy_probe(name = "local")
policy_probe(
    name = "remote_ready",
    mode = "remote-ready",
    evidence = {
        "source_snapshot": True,
        "materialization_manifest": True,
        "artifact_contract": True,
        "builder_policy": True,
        "remote_builder_smoke": True,
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
      'load("//tmp/policy_defs:defs.bzl", "policy_probe")\npolicy_probe(name = "t", mode = "hybrid", evidence = {"source_snapshot": True, "materialization_manifest": True, "artifact_contract": True, "builder_policy": True, "remote_builder_smoke": True, "remote_profile_compatibility": True})\n',
      "utf8",
    );
    await fs.writeFile(path.join(valid, "TARGETS"), validTargets, "utf8");

    const iso = inheritedBuckIsolation("remote_action_policy_analysis");
    const ok = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${iso} cquery //tmp/policy_valid:remote_ready`;
    assert.equal(ok.exitCode, 0, String(ok.stderr || ""));

    const missing = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${iso} cquery //tmp/policy_missing:t`;
    assert.notEqual(missing.exitCode, 0);
    assert.match(String(missing.stderr || ""), /source_snapshot/);
    assert.match(String(missing.stderr || ""), /remote_profile_compatibility/);

    const hybrid = await $({
      cwd: tmp,
      stdio: "pipe",
      nothrow: true,
    })`buck2 --isolation-dir ${iso} cquery //tmp/policy_hybrid:t`;
    assert.notEqual(hybrid.exitCode, 0);
    assert.match(String(hybrid.stderr || ""), /fallback_reason/);
  });
});
