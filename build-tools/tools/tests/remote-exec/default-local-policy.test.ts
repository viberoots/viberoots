#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { evaluateDefaultLocalPolicy } from "../../remote-exec/default-local-policy";

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "default-local-policy-"));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, text, "utf8");
  }
  return root;
}

const localBuckconfig = `[buildfile]
name = TARGETS

[build]
target_platforms = prelude//platforms:default
`;

const localToolchain = `remote_test_execution_toolchain(
    name = "remote_test_execution",
    default_profile = None,
    default_run_as_bundle = False,
    visibility = ["PUBLIC"],
)
`;

test("default-local policy allows inert remote profile and platform surfaces", async () => {
  const root = await fixture({
    ".buckconfig": localBuckconfig,
    "package.json": '{"scripts":{"test":"buck2 test //..."}}\n',
    "TESTING.md": "Run `buck2 test //...` for a direct local test.\n",
    Jenkinsfile: "pipeline { environment { CI = 'true' } }\n",
    "toolchains/TARGETS": localToolchain,
    "toolchains/remote_execution_profiles.bzl": "REMOTE_PROFILES = {'linux-x86_64-default': {}}\n",
    "toolchains/remote_execution_platforms.bzl": "def remote_execution_platforms(): return []\n",
    "build-tools/tools/remote-exec/example-template.json": '{"endpoint":"re.example.invalid"}\n',
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, true);
  assert.ok(report.dormantSurfaces.includes("toolchains/remote_execution_profiles.bzl"));
  assert.ok(report.dormantSurfaces.includes("toolchains/remote_execution_platforms.bzl"));
});

test("default-local policy rejects active Buck remote defaults", async () => {
  const root = await fixture({
    ".buckconfig": `${localBuckconfig}
[buck2_re_client]
engine_address = grpc://re.prod.internal

[build]
execution_platforms = toolchains//:remote_execution_platforms
`,
    "toolchains/TARGETS": localToolchain,
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, false);
  assert.match(report.findings.map((f) => f.message).join("\n"), /remote execution client/);
  assert.match(report.findings.map((f) => f.message).join("\n"), /execution_platforms/);
});

test("default-local policy rejects Jenkins remote env defaults", async () => {
  const root = await fixture({
    ".buckconfig": localBuckconfig,
    Jenkinsfile: "pipeline { environment { VBR_REMOTE_EXEC_MODE = 'remote' } }\n",
    "toolchains/TARGETS": localToolchain,
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, false);
  assert.match(report.findings[0]?.message || "", /VBR_REMOTE_EXEC_MODE/);
});

test("default-local policy rejects selected remote test profiles", async () => {
  const root = await fixture({
    ".buckconfig": localBuckconfig,
    "toolchains/TARGETS": `remote_test_execution_toolchain(
    name = "remote_test_execution",
    default_profile = "linux-x86_64-default",
)
`,
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, false);
  assert.match(report.findings[0]?.message || "", /default_profile/);
});

test("default-local policy rejects committed secrets and direct remote Buck config", async () => {
  const root = await fixture({
    ".buckconfig": localBuckconfig,
    "toolchains/TARGETS": localToolchain,
    "package.json":
      '{"scripts":{"test":"buck2 test //... --config-file $VBR_REMOTE_BUCK_CONFIG"}}\n',
    "TESTING.md":
      "Do not run `buck2 test //... --config-file $VBR_REMOTE_BUCK_CONFIG` by default.\n",
    "docs/handbook/testing.md": "`buck2 test //... --config-file $VBR_REMOTE_BUCK_CONFIG`\n",
    "build-tools/tools/bin/local-test": "buck2 test //... --config-file $VBR_REMOTE_BUCK_CONFIG\n",
    "build-tools/tools/ci/run-stage.ts":
      "await $`buck2 test //... --config-file $VBR_REMOTE_BUCK_CONFIG`;\n",
    "build-tools/tools/dev/verify/buck2-test.ts": "await $`buck2 test //...`;\n",
    "build-tools/tools/remote-exec/generated-config.example.json":
      '{"endpoint":"grpc://re.prod.internal","token":"abcdefghijklmnop","cache_access_key":"AKIAIOSFODNN7EXAMPLE"}\n',
  });

  const report = await evaluateDefaultLocalPolicy(root);

  assert.equal(report.ok, false);
  const text = report.findings.map((f) => f.message).join("\n");
  assert.match(text, /real-looking endpoint/);
  assert.match(text, /secret-looking/);
  assert.match(text, /cache credential/);
  assert.match(text, /direct buck2 test/);
});

test("default-local policy passes against the current repository", async () => {
  const report = await evaluateDefaultLocalPolicy(process.cwd());
  assert.deepEqual(report.findings, []);
});
