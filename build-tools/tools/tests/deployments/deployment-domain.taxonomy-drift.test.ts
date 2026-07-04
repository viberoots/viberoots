#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsRepoPath } from "./deployment-command";

function buckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}

async function copyCurrentBuckClassificationFiles(tmp: string): Promise<void> {
  const relPaths = [
    "build-tools/tools/tests/defs.bzl",
    "build-tools/tools/tests/deployment_conventions.bzl",
    "build-tools/tools/tests/enforcement_conventions.bzl",
    "build-tools/tools/tests/isolated_test_conventions.bzl",
    "build-tools/tools/tests/resource_limited_conventions.bzl",
    "build-tools/tools/tests/resource_limited_taxonomy.bzl",
    "build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl",
    "build-tools/tools/tests/deployments/deployment_resource_limited_taxonomy.bzl",
  ];
  for (const relPath of relPaths) {
    const src = viberootsRepoPath(relPath);
    const dst = path.join(tmp, relPath);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
  }
}

async function writeTempWorkspaceRootTargets(tmp: string): Promise<void> {
  await fsp.writeFile(
    path.join(tmp, "TARGETS"),
    [
      'load("@viberoots//build-tools/tools/tests:defs.bzl", "auto_zx_tests")',
      'load("@prelude//:rules.bzl", "export_file")',
      "",
      "platform(",
      '    name = "no_cgo",',
      "    constraint_values = [",
      '        "config//go/constraints:cgo_enabled_false",',
      '        "config//go/constraints:asan_false",',
      '        "config//go/constraints:race_false",',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "auto_zx_tests(",
      '    root = "build-tools/tools/tests",',
      "    patterns = [",
      '        "**/*.test.ts",',
      '        "e2e-provider-wiring.ts",',
      "    ],",
      ")",
      "",
      "export_file(",
      '    name = "flake.lock",',
      '    src = "flake.lock",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
    "utf8",
  );
}

test("deployment-domain taxonomy drift fails closed for unclassified deployment tests", async () => {
  await runInTemp("deployment-domain-taxonomy-drift", async (tmp, $) => {
    await copyCurrentBuckClassificationFiles(tmp);
    await writeTempWorkspaceRootTargets(tmp);
    const driftPath = path.join(
      tmp,
      "build-tools/tools/tests/deployments/unclassified.deployment-domain.test.ts",
    );
    await fsp.writeFile(
      driftPath,
      [
        "#!/usr/bin/env zx-wrapper",
        'import { test } from "node:test";',
        'test("unclassified deployment-domain drift fixture", () => {});',
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      env: buckEnv(),
    })`buck2 cquery --target-platforms prelude//platforms:default //...`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || ""), /deployment-domain taxonomy drift/);
    assert.match(String(result.stderr || ""), /deployment_domain_taxonomy\.bzl/);
    assert.match(String(result.stderr || ""), /unclassified\.deployment-domain\.test\.ts/);
  });
});

test("resource-limited deployment taxonomy stays data-only", async () => {
  const relPaths = [
    "build-tools/tools/tests/deployments/deployment_resource_limited_taxonomy.bzl",
    "build-tools/tools/tests/resource_limited_taxonomy.bzl",
  ];
  const executablePatterns = [/\bload\s*\(/, /^\s*if\s+/m, /^\s*for\s+/m, /\bfor\b.*\bin\b/];

  for (const relPath of relPaths) {
    const text = await fsp.readFile(viberootsRepoPath(relPath), "utf8");
    const codeOnly = text
      .split("\n")
      .map((line) => line.replace(/#.*/, ""))
      .join("\n");
    for (const pattern of executablePatterns) {
      assert.doesNotMatch(codeOnly, pattern, `${relPath} must keep resource membership data-only`);
    }
  }
});
