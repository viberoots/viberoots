#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const VIBEROOTS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const execFileAsync = promisify(execFile);

function sourceFile(rel: string): string {
  return path.join(VIBEROOTS_ROOT, rel);
}

test("standalone command scopes reject every inherited cache-health marker", async () => {
  const scope = sourceFile("build-tools/tools/bin/cache-health-command-scope.sh");
  const { stdout } = await execFileAsync("/bin/bash", [
    "-c",
    `export VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED=1 VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE=1 VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=hostile VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS=hostile VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS=hostile VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY=strict; . ${JSON.stringify(scope)} standalone; test -z "\${VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS:-}\${VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS:-}\${VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY:-}"; printf '%s:%s:%s\\n' "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}"`,
  ]);
  assert.equal(stdout, ":1:\n");
});

test("verified ingress always starts a fresh command-scoped cache decision", async () => {
  const scope = sourceFile("build-tools/tools/bin/cache-health-command-scope.sh");
  const { stdout } = await execFileAsync("/bin/bash", [
    "-c",
    `export VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED=1 VBR_NIX_CACHE_HEALTH_APPLIED=1; . ${JSON.stringify(scope)} verified-ingress; printf '%s:%s\\n' "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE"; unset VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED; export VBR_NIX_CACHE_HEALTH_APPLIED=1; . ${JSON.stringify(scope)} verified-ingress; printf '%s:%s\\n' "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE"`,
  ]);
  assert.equal(stdout, ":1\n:1\n");
});

test("fresh command scope restores stage0 source config before dropping reviewed authority", async () => {
  const scope = sourceFile("build-tools/tools/bin/cache-health-command-scope.sh");
  const sourceConfig =
    "extra-substituters = https://auth.example/cache\nnetrc-file = /tmp/reviewed.netrc";
  const { stdout } = await execFileAsync("/bin/bash", [
    "-c",
    `export NIX_CONFIG=stale VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=stale VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG="$1"; . "$2" standalone; printf '%s\\036%s:%s' "$NIX_CONFIG" "\${VBR_NIX_CACHE_HEALTH_APPLIED+x}" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG+x}"`,
    "cache-source-restore",
    sourceConfig,
    scope,
  ]);
  assert.equal(stdout, `${sourceConfig}\u001e:`);
});

test("every command front door selects its fixed cache-scope authority", async () => {
  const ingressCommands = ["build", "p", "verify"];
  const standaloneCommands = ["install-deps", "u", "v"];
  for (const command of ingressCommands) {
    const source = await fsp.readFile(sourceFile(`build-tools/tools/bin/${command}`), "utf8");
    assert.match(source, /cache-health-command-scope\.sh" verified-ingress/);
    assert.ok(
      source.indexOf("artifact_ingress_reexec_with_devshell") <
        source.indexOf("cache-health-command-scope.sh"),
    );
    assert.ok(
      source.indexOf("cache-health-command-scope.sh") <
        source.indexOf("artifact_ingress_clear_selectors"),
    );
    assert.ok(
      source.indexOf("artifact_ingress_trust_devshell_baseline") <
        source.indexOf("artifact_ingress_refresh_nix_cache_health"),
    );
    assert.ok(
      source.indexOf("artifact_ingress_refresh_nix_cache_health") <
        source.indexOf("artifact_ingress_publish_reviewed_nix_cache_config"),
    );
    assert.ok(
      source.indexOf("artifact_ingress_publish_reviewed_nix_cache_config") <
        source.indexOf("artifact_ingress_restore_or_remove_selectors"),
    );
  }
  for (const command of standaloneCommands) {
    const source = await fsp.readFile(sourceFile(`build-tools/tools/bin/${command}`), "utf8");
    assert.match(source, /cache-health-command-scope\.sh" standalone/);
    assert.doesNotMatch(source, /cache-health-command-scope\.sh" verified-ingress/);
  }
  const verify = await fsp.readFile(sourceFile("build-tools/tools/bin/verify"), "utf8");
  assert.match(
    verify,
    /artifact_ingress_clear_selectors[\s\S]*export VBR_DEVSHELL_USE_GENERATED_AUTHORITY=1[\s\S]*devshell\.sh/,
  );
  assert.match(
    verify,
    /artifact_ingress_publish_reviewed_nix_cache_config[\s\S]*artifact_ingress_restore_or_remove_selectors[\s\S]*artifact_ingress_clear_selectors[\s\S]*artifact_ingress_exec/,
  );
});

test("cache scope rejects missing or caller-controlled source modes", async () => {
  const scope = sourceFile("build-tools/tools/bin/cache-health-command-scope.sh");
  for (const mode of ["", "hostile"]) {
    const result = await execFileAsync("/bin/bash", [
      "-c",
      `. ${JSON.stringify(scope)} ${JSON.stringify(mode)}`,
    ]).then(
      () => ({ status: 0 }),
      (error: { code?: number }) => ({ status: error.code }),
    );
    assert.equal(result.status, 64);
  }
});
