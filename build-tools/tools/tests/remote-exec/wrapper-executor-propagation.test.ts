#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const fixtureRoot = "//build-tools/tools/tests/remote-exec/wrapper-fixtures";
const wrappers = ["zx", "node", "go", "python", "cpp"];
const activationConfig = ["-c", "test.viberoots_remote_profile=linux-x86_64-default"];

function target(wrapper: string, mode: "local" | "remote"): string {
  return `${fixtureRoot}:${wrapper}_${mode}`;
}

function readyTarget(wrapper: string): string {
  return `${fixtureRoot}:${wrapper}_ready_handles`;
}

async function auditProviders(
  label: string,
  buckArgs: string[] = [],
  cwd = process.cwd(),
): Promise<string> {
  const result = await $({
    cwd,
    stdio: "pipe",
  })`buck2 --isolation-dir ${inheritedBuckIsolation("remote-exec-wrapper-propagation")} audit providers ${buckArgs} --target-platforms prelude//platforms:default ${label}`.nothrow();
  assert.equal(result.exitCode, 0, `${label}\n${result.stderr}`);
  return String(result.stdout || "");
}

async function cqueryAttrs(label: string, buckArgs: string[] = []): Promise<string> {
  const result = await $({
    stdio: "pipe",
  })`buck2 --isolation-dir ${inheritedBuckIsolation("remote-exec-wrapper-propagation")} cquery ${buckArgs} --target-platforms prelude//platforms:default --json --output-attribute labels --output-attribute remote_execution ${label}`.nothrow();
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
  assert.match(providerText, /"remote:local-only"/);
}

function expectRemoteProvider(providerText: string): void {
  expectProjectRelative(providerText);
  assert.match(providerText, /default_executor=CommandExecutorConfig/);
  assert.match(providerText, /RemoteEnabledExecutorOptions/);
  assert.match(providerText, /data: "buck2-test"/);
  assert.match(providerText, /executor_overrides=\{\s*"listing": CommandExecutorConfig/s);
  assert.match(providerText, /"existing:label"/);
  assert.match(providerText, /"remote:local-only"/);
}

function externalRunnerCommand(providerText: string): string {
  const match = providerText.match(
    /ExternalRunnerTestInfo\([\s\S]*?command=\[(?<body>[\s\S]*?)\],\n\s+env=/,
  );
  assert.ok(match?.groups?.body, "expected ExternalRunnerTestInfo command body");
  return match.groups.body;
}

function expectDeclaredHandles(providerText: string, names: string[]): void {
  const command = externalRunnerCommand(providerText);
  const hidden = command.match(/hidden=\[(?<body>[\s\S]*?)\]/)?.groups?.body || "";
  assert.match(command, /cmd_args\(/);
  assert.match(command, /remote-ready-runner\.sh/);
  for (const name of names) assert.match(hidden, new RegExp(name.replace(".", "\\.")));
  const executableText = command.replace(/hidden=\[[\s\S]*?\]/g, "hidden=[]");
  assert.doesNotMatch(executableText, /WORKSPACE_ROOT|FLK_ROOT|BUCK_TEST_SRC|"[^"]*build-tools\//);
  assert.doesNotMatch(executableText, /"-c"/);
  assert.doesNotMatch(
    executableText,
    /command -v|\bbash\b|\bnode\b|\bnix\b|\btimeout\b|\bgit\b|\bfind\b/,
  );
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

const expectedReadyHandles = new Map<string, string[]>([
  [
    "zx",
    [
      "noop.test.ts",
      "fixture.txt",
      "zx_ready_source_snapshot.source-snapshot",
      "zx_ready_source_snapshot.source-snapshot.manifest.json",
      "remote-ready-runner.sh",
      "zx-init.mjs",
      "command-heartbeat.ts",
      "node-modules-build.ts",
    ],
  ],
  [
    "node",
    [
      "fixture.txt",
      "remote-ready-runner.sh",
      "zx-init.mjs",
      "command-heartbeat.ts",
      "prepare-exact-pnpm-store.ts",
      "nix-build-filtered-flake.ts",
      "graph.json",
      "workspace-root.env",
    ],
  ],
  [
    "go",
    [
      "fixture.txt",
      "remote-ready-runner.sh",
      "zx-init.mjs",
      "build-selected.ts",
      "graph.json",
      "workspace-root.env",
    ],
  ],
  [
    "python",
    [
      "fixture.txt",
      "remote-ready-runner.sh",
      "zx-init.mjs",
      "build-selected.ts",
      "graph.json",
      "workspace-root.env",
    ],
  ],
  [
    "cpp",
    [
      "fixture.txt",
      "remote-ready-runner.sh",
      "zx-init.mjs",
      "build-selected.ts",
      "graph.json",
      "workspace-root.env",
    ],
  ],
]);

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
      "build-tools/tools/tests/remote-exec/wrapper-fixtures/TARGETS",
    );
    await fs.writeFile(path.join(tmp, "build-tools/tools/buck/graph.json"), "[]\n", "utf8");
    await fs.writeFile(path.join(tmp, "build-tools/tools/buck/workspace-root.env"), "\n", "utf8");
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
