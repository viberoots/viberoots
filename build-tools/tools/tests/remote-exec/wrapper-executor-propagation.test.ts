#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { killBuckIsolation } from "../../dev/verify/process-control";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";
import {
  expectDeclaredHandles,
  expectedReadyHandles,
  expectLocalProvider,
  expectProjectRelative,
  expectRemoteProvider,
  fixtureRoot,
  readyTarget,
  target,
  wrappers,
} from "./wrapper-executor-propagation-assertions";

const activationConfig = ["-c", "test.viberoots_remote_profile=linux-x86_64-default"];
const wrapperIsolation = inheritedBuckIsolation("remote-exec-wrapper-propagation");

after(async () => await killBuckIsolation(process.cwd(), wrapperIsolation));

async function auditProviders(
  label: string,
  buckArgs: string[] = [],
  cwd = process.cwd(),
): Promise<string> {
  const result = await $({
    cwd,
    stdio: "pipe",
  })`buck2 --isolation-dir ${wrapperIsolation} audit providers ${buckArgs} --target-platforms prelude//platforms:default ${label}`.nothrow();
  assert.equal(result.exitCode, 0, `${label}\n${result.stderr}`);
  return String(result.stdout || "");
}

async function cqueryAttrs(label: string, buckArgs: string[] = []): Promise<string> {
  const result = await $({
    stdio: "pipe",
  })`buck2 --isolation-dir ${wrapperIsolation} cquery ${buckArgs} --target-platforms prelude//platforms:default --json --output-attribute labels --output-attribute remote_execution ${label}`.nothrow();
  assert.equal(result.exitCode, 0, `${label}\n${result.stderr}`);
  return String(result.stdout || "");
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

test("single active remote-ready fixture carries declared input handles", async () => {
  const providerText = await auditProviders(readyTarget("zx"));
  expectProjectRelative(providerText);
  expectDeclaredHandles(providerText, expectedReadyHandles.get("zx") || []);
  assert.match(providerText, /"remote:ready"/);
  assert.doesNotMatch(providerText, /"remote:local-only"/);
});

test("remote-ready wrapper command providers carry declared input handles in generated fixtures", async () => {
  const expectedHandles = new Map<string, string[]>([...expectedReadyHandles]);
  await runInTemp("remote-ready-wrapper-handle-fixtures", async (tmp) => {
    const targetsPath = path.join(
      tmp,
      "viberoots/build-tools/tools/tests/remote-exec/wrapper-fixtures/TARGETS",
    );
    await fs.writeFile(path.join(tmp, ".viberoots/workspace/buck/graph.json"), "[]\n", "utf8");
    await fs.writeFile(
      path.join(tmp, "viberoots/build-tools/tools/buck/workspace-root.env"),
      "\n",
      "utf8",
    );
    let text = await fs.readFile(targetsPath, "utf8");
    text = text.replaceAll(
      'labels = ["fixture:ready", "existing:label", "verify:manual"]',
      'labels = ["fixture:ready", "existing:label", "remote:ready", "verify:manual"]',
    );
    text = text.replaceAll(
      'labels = ["fixture:ready", "existing:label", "lang:go", "patch_scope:package-local", "verify:manual"]',
      'labels = ["fixture:ready", "existing:label", "remote:ready", "lang:go", "patch_scope:package-local", "verify:manual"]',
    );
    await fs.writeFile(targetsPath, text, "utf8");
    for (const [wrapper, handles] of expectedHandles) {
      const providerText = await auditProviders(readyTarget(wrapper), [], tmp);
      expectProjectRelative(providerText);
      expectDeclaredHandles(providerText, handles);
      if (wrapper === "node") {
        assert.doesNotMatch(providerText, /prepare-(?:exact|final)-pnpm-store\.ts/);
      }
      assert.match(providerText, /"remote:ready"/);
      assert.doesNotMatch(providerText, /"remote:local-only"/);
    }
  });
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
