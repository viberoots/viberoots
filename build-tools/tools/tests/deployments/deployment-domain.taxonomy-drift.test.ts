#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveNestedBuckIsolation } from "../../lib/buck-command-env";
import { runInTemp } from "../lib/test-helpers";

function buckEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
  };
}

async function copyCurrentBuckClassificationFiles(tmp: string): Promise<void> {
  const repoRoot = process.cwd();
  const relPaths = [
    "build-tools/tools/tests/defs.bzl",
    "build-tools/tools/tests/deployment_conventions.bzl",
    "build-tools/tools/tests/deployments/deployment_domain_taxonomy.bzl",
  ];
  for (const relPath of relPaths) {
    const src = path.join(repoRoot, relPath);
    const dst = path.join(tmp, relPath);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
  }
}

async function writeTempWorkspaceRootTargets(tmp: string): Promise<void> {
  await fsp.writeFile(
    path.join(tmp, "TARGETS"),
    [
      'load("//build-tools/tools/tests:defs.bzl", "auto_zx_tests")',
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
    const { isolationDir, ownsIsolation } = resolveNestedBuckIsolation({
      root: tmp,
      prefix: "deployment-domain-taxonomy-drift",
    });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      env: buckEnv(),
    })`buck2 --isolation-dir ${isolationDir} cquery --target-platforms prelude//platforms:default //...`.nothrow();
    if (ownsIsolation) {
      await $({
        cwd: tmp,
        stdio: "ignore",
        reject: false,
        env: buckEnv(),
      })`buck2 --isolation-dir ${isolationDir} kill`;
    }
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr || ""), /deployment-domain taxonomy drift/);
    assert.match(String(result.stderr || ""), /deployment_domain_taxonomy\.bzl/);
    assert.match(String(result.stderr || ""), /unclassified\.deployment-domain\.test\.ts/);
  });
});
