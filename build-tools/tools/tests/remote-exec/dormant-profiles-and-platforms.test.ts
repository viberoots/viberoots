#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";

const profilesPath = "viberoots/toolchains/remote_execution_profiles.bzl";
const platformsPath = "viberoots/toolchains/remote_execution_platforms.bzl";
const expectedProfiles = [
  "linux-x86_64-default",
  "linux-x86_64-large",
  "linux-aarch64-default",
  "linux-aarch64-large",
  "darwin-aarch64-default",
];
const allowedProfileKeys = [
  "capabilities",
  "dependencies",
  "listing_capabilities",
  "local_enabled",
  "local_listing_enabled",
  "remote_cache_enabled",
  "remote_execution_dynamic_image",
  "resource_units",
  "use_case",
];

test("remote test profiles expose the reviewed schema without selecting defaults", async () => {
  const source = await fs.readFile(profilesPath, "utf8");
  const providers = await $({
    stdio: "pipe",
  })`buck2 audit providers repo_toolchains//:remote_test_execution`.nothrow();

  assert.equal(providers.exitCode, 0, providers.stderr);
  assert.match(providers.stdout, /default_profile=None/);
  assert.match(providers.stdout, /default_run_as_bundle=False/);
  for (const profile of expectedProfiles) {
    assert.match(providers.stdout, new RegExp(`"${profile}"`));
    assert.match(source, new RegExp(`"${profile}"`));
  }
  for (const key of allowedProfileKeys) {
    assert.match(source, new RegExp(`"${key}": True`));
  }
  assert.match(source, /if key not in REMOTE_PROFILE_ALLOWED_KEYS:/);
  assert.match(source, /missing capabilities/);
  assert.match(source, /missing use_case/);
  assert.doesNotMatch(source, /worker_image|fallback_policy|platform_alias|provider_identity/);
});

test("each named profile converts through Prelude remote executor props", async () => {
  for (const profile of expectedProfiles) {
    const target = `repo_toolchains//:remote_profile_conversion_${profile.replaceAll("-", "_")}`;
    const probe = await $({ stdio: "pipe" })`buck2 audit providers ${target}`.nothrow();
    assert.equal(probe.exitCode, 0, `${target}\n${probe.stderr}`);
  }
});

test("dormant remote execution platforms analyze with explicit executor policy", async () => {
  const source = await fs.readFile(platformsPath, "utf8");
  const providers = await $({
    stdio: "pipe",
  })`buck2 audit providers repo_toolchains//:remote_execution_platforms`.nothrow();

  assert.equal(providers.exitCode, 0, providers.stderr);
  assert.match(providers.stdout, /ExecutionPlatformRegistrationInfo/);
  assert.match(providers.stdout, /repo_toolchains\/\/:remote_linux_x86_64_default/);
  assert.match(providers.stdout, /repo_toolchains\/\/:remote_linux_x86_64_hybrid_default/);
  assert.match(providers.stdout, /repo_toolchains\/\/:remote_local_fallback/);
  assert.match(providers.stdout, /"viberoots_remote_profile": "linux-x86_64-default"/);
  assert.match(providers.stdout, /RemoteExecutorUseCaseData\(\s*"buck2-build"/);
  assert.match(providers.stdout, /executor: Local/);
  assert.match(source, /local_enabled = local_enabled/);
  assert.match(source, /remote_enabled = remote_enabled/);
  assert.match(source, /use_limited_hybrid = use_limited_hybrid/);
});

test("ordinary execution-platform resolution stays local unless config opts in", async () => {
  const local = await $({
    stdio: "pipe",
  })`buck2 audit execution-platform-resolution //.viberoots/workspace:flake.lock`.nothrow();
  assert.equal(local.exitCode, 0, local.stderr);
  assert.match(local.stdout, /Execution platforms are not configured/);
  assert.match(local.stdout, /Execution platform: <[^>]+_global_exec_platform>/);

  const remote = await $({
    stdio: "pipe",
  })`buck2 audit execution-platform-resolution -c build.execution_platforms=repo_toolchains//:remote_execution_platforms //.viberoots/workspace:flake.lock`.nothrow();
  assert.equal(remote.exitCode, 0, remote.stderr);
  assert.match(remote.stdout, /repo_toolchains\/\/:remote_execution_platforms/);
  assert.match(remote.stdout, /repo_toolchains\/\/:remote_linux_x86_64_default/);
});
