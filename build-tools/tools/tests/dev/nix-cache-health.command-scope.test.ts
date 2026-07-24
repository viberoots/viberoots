#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
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
    `export VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED=1 VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE=1 VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=hostile; . ${JSON.stringify(scope)} standalone; printf '%s:%s:%s\\n' "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE" "\${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}"`,
  ]);
  assert.equal(stdout, ":1:\n");
});

test("verified ingress preserves only its FD-authenticated devshell decision", async () => {
  const scope = sourceFile("build-tools/tools/bin/cache-health-command-scope.sh");
  const { stdout } = await execFileAsync("/bin/bash", [
    "-c",
    `export VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED=1 VBR_NIX_CACHE_HEALTH_APPLIED=1; . ${JSON.stringify(scope)} verified-ingress; printf '%s:%s\\n' "$VBR_NIX_CACHE_HEALTH_APPLIED" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE"; unset VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED; export VBR_NIX_CACHE_HEALTH_APPLIED=1; . ${JSON.stringify(scope)} verified-ingress; printf '%s:%s\\n' "\${VBR_NIX_CACHE_HEALTH_APPLIED:-}" "$VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE"`,
  ]);
  assert.equal(stdout, "1:1\n:1\n");
});

test("every command front door selects its fixed cache-scope authority", async () => {
  const ingressCommands = ["build", "p"];
  const standaloneCommands = ["install-deps", "u", "v", "verify"];
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
