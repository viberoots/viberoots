#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { inheritedBuckIsolation } from "../lib/test-helpers";

const fixtureRoot = "//build-tools/tools/tests/remote-exec/wrapper-fixtures";
const wrappers = ["zx", "node", "go", "python", "cpp"];
const isolation = inheritedBuckIsolation("remote-exec-wrapper-propagation");
const activationConfig = ["-c", "test.viberoots_remote_profile=linux-x86_64-default"];

function target(wrapper: string, mode: "local" | "remote"): string {
  return `${fixtureRoot}:${wrapper}_${mode}`;
}

async function auditProviders(label: string, buckArgs: string[] = []): Promise<string> {
  const result = await $({
    stdio: "pipe",
  })`buck2 --isolation-dir ${isolation} audit providers ${buckArgs} --target-platforms prelude//platforms:default ${label}`.nothrow();
  assert.equal(result.exitCode, 0, `${label}\n${result.stderr}`);
  return String(result.stdout || "");
}

async function cqueryAttrs(label: string, buckArgs: string[] = []): Promise<string> {
  const result = await $({
    stdio: "pipe",
  })`buck2 --isolation-dir ${isolation} cquery ${buckArgs} --target-platforms prelude//platforms:default --json --output-attribute labels --output-attribute remote_execution ${label}`.nothrow();
  assert.equal(result.exitCode, 0, `${label}\n${result.stderr}`);
  return String(result.stdout || "");
}

function expectProjectRelative(providerText: string): void {
  assert.match(providerText, /run_from_project_root=True/);
  assert.match(providerText, /use_project_relative_paths=True/);
}

function expectLocalProvider(providerText: string): void {
  expectProjectRelative(providerText);
  assert.match(providerText, /default_executor=None/);
  assert.match(providerText, /executor_overrides={}/);
  assert.match(providerText, /"existing:label"/);
}

function expectRemoteProvider(providerText: string): void {
  expectProjectRelative(providerText);
  assert.match(providerText, /default_executor=CommandExecutorConfig/);
  assert.match(providerText, /RemoteEnabledExecutorOptions/);
  assert.match(providerText, /data: "buck2-test"/);
  assert.match(providerText, /executor_overrides=\{\s*"listing": CommandExecutorConfig/s);
  assert.match(providerText, /"existing:label"/);
}

test("repo-owned external-runner wrappers default to local executor fields", async () => {
  for (const wrapper of wrappers) {
    const label = target(wrapper, "local");
    expectLocalProvider(await auditProviders(label));
    const attrs = await cqueryAttrs(label);
    if (wrapper === "zx") assert.match(attrs, /"remote_execution": ""/);
    else assert.match(attrs, /"remote_execution": null/);
    assert.match(attrs, /"existing:label"/);
  }
});

test("repo-owned external-runner wrappers propagate explicit remote executor fields", async () => {
  for (const wrapper of wrappers) {
    const label = target(wrapper, "remote");
    expectRemoteProvider(await auditProviders(label));
    const attrs = await cqueryAttrs(label);
    assert.match(attrs, /"remote_execution": "linux-x86_64-default"/);
    assert.match(attrs, /"existing:label"/);
  }
});

test("zx_test reads PR7 activation config when target attr is unset", async () => {
  const label = target("zx", "local");
  expectRemoteProvider(await auditProviders(label, activationConfig));
  const attrs = await cqueryAttrs(label, activationConfig);
  assert.match(attrs, /"remote_execution": "linux-x86_64-default"/);
  assert.match(attrs, /"existing:label"/);
});

test("zx_test empty-string local sentinel ignores preexisting bundle label", async () => {
  const label = `${fixtureRoot}:zx_local_labeled_bundle_ignore`;
  expectLocalProvider(await auditProviders(label));
  const attrs = await cqueryAttrs(label);
  assert.match(attrs, /"remote_execution": ""/);
  assert.match(attrs, /"re_ignore_force_run_as_bundle"/);
});
