#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ingressScript = "viberoots/build-tools/tools/bin/artifact-ingress-env.sh";
const cacheScopeScript = path.resolve(
  "viberoots/build-tools/tools/bin/cache-health-command-scope.sh",
);

function writeManifest(workspace: string, root: string): void {
  const manifest = path.join(workspace, ".viberoots", "workspace", "toolchain-paths.json");
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, `${JSON.stringify({ artifactTools: { root } }, null, 2)}\n`);
}

test("shell ingress rejects store traversal before executing the declared wrapper", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-traversal-"));
  try {
    writeManifest(
      workspace,
      "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-tools/../../tmp/host-tools",
    );
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; artifact_ingress_tools_root "$2"',
        "artifact-ingress-test",
        ingressScript,
        workspace,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canonical artifact tool authority is invalid/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("shell ingress does not trust inherited devshell baseline metadata", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-baseline-"));
  const toolsRoot = JSON.parse(fs.readFileSync(".viberoots/workspace/toolchain-paths.json", "utf8"))
    .artifactTools.root as string;
  try {
    writeManifest(workspace, toolsRoot);
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; export IN_NIX_SHELL=impure VBR_ARTIFACT_INGRESS_DIRENV_TOKEN=forged VBR_DEVSHELL_ARTIFACT_BASELINE=1 VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT="$3"; artifact_ingress_trust_devshell_baseline "$2"; test -z "${VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED:-}"',
        "artifact-ingress-test",
        ingressScript,
        workspace,
        toolsRoot,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("shell ingress captures hostile selectors when a forged re-entry token has no proof fd", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-forged-token-"));
  try {
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; cd "$2"; export CC=/host/clang VBR_ARTIFACT_INGRESS_DIRENV_TOKEN=forged; artifact_ingress_reexec_with_devshell /bin/true; test -z "${VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED:-}"; test "${VBR_ARTIFACT_INGRESS_VALUE_CC:-}" = /host/clang; test -z "${CC:-}"',
        "artifact-ingress-test",
        ingressScript,
        workspace,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("shell ingress establishes a cleared generated-authority baseline without .envrc", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-no-envrc-"));
  const toolsRoot = JSON.parse(fs.readFileSync(".viberoots/workspace/toolchain-paths.json", "utf8"))
    .artifactTools.root as string;
  try {
    writeManifest(workspace, toolsRoot);
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; cd "$2"; unset IN_NIX_SHELL; export NIX_CONFIG=hostile VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG=hostile; artifact_ingress_reexec_with_devshell /bin/true; test "${VBR_ARTIFACT_INGRESS_NO_ENVRC_VERIFIED:-}" = 1; test "${VBR_DEVSHELL_ARTIFACT_BASELINE:-}" = 1; test -z "${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG:-}"; test -z "${NIX_CONFIG:-}"; artifact_ingress_trust_devshell_baseline "$2"; test "${VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED:-}" = 1',
        "artifact-ingress-test",
        ingressScript,
        workspace,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("shell ingress hands off only a readable effective netrc path", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-netrc-"));
  const netrc = path.join(workspace, "reviewed.netrc");
  fs.writeFileSync(netrc, "machine cache.invalid password fixture-secret\n", { mode: 0o600 });
  try {
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; reviewed="$(artifact_ingress_validated_effective_netrc_from_config "$2")"; test "$reviewed" = "$3"; test "$reviewed" != fixture-secret; missing="$(artifact_ingress_validated_effective_netrc_from_config "netrc-file = $3.missing")"; test -z "$missing"; relative="$(artifact_ingress_validated_effective_netrc_from_config "netrc-file = relative.netrc")"; test -z "$relative"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE="$3"; env_strip_nix_cache_overrides() { printf %s "builders ="; }; env_apply_nix_cache_health() { case "$NIX_CONFIG" in *"netrc-file = $3"*) ;; *) return 1 ;; esac; case "$NIX_CONFIG" in *fixture-secret*) return 1 ;; esac; export VBR_NIX_CACHE_HEALTH_APPLIED=1; }; artifact_ingress_refresh_nix_cache_health',
        "artifact-ingress-test",
        ingressScript,
        `substituters = https://cache.invalid/\nnetrc-file = ${netrc}`,
        netrc,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /fixture-secret/);
    assert.doesNotMatch(result.stderr, /fixture-secret/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("shell ingress consumes a valid re-entry proof exactly once", () => {
  const token = "test-proof";
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; exec 9<<<"$2"; export VBR_ARTIFACT_INGRESS_DIRENV_TOKEN="$2"; artifact_ingress_reexec_with_devshell /bin/true; test "${VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED:-}" = 1; test -z "${VBR_ARTIFACT_INGRESS_DIRENV_TOKEN:-}"; ! IFS= read -r _ <&9',
      "artifact-ingress-test",
      ingressScript,
      token,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("shell ingress clears hostile cache scope markers before authenticated re-entry", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-cache-scope-"));
  const token = "cache-scope-proof";
  try {
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; cd "$3"; export VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE=1 VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=hostile; artifact_ingress_reexec_with_devshell /bin/true; test -z "${VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE:-}"; test -z "${VBR_NIX_CACHE_HEALTH_APPLIED:-}"; test -z "${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}"; exec 9<<<"$4"; export VBR_ARTIFACT_INGRESS_DIRENV_ROOT="$3" VBR_ARTIFACT_INGRESS_DIRENV_TOKEN="$4"; artifact_ingress_reexec_with_devshell /bin/true; test "${VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED:-}" = 1; . "$2" verified-ingress; test "${VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE:-}" = 1; test -z "${VBR_NIX_CACHE_HEALTH_APPLIED:-}"; test -z "${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}"',
        "artifact-ingress-test",
        ingressScript,
        cacheScopeScript,
        workspace,
        token,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("shell ingress hands off only the exact FD-verified devshell cache decision", () => {
  const reviewed = "substituters =\nextra-substituters =\nfallback = true";
  const trusted = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_NIX_CACHE_HEALTH_APPLIED=1 NIX_CONFIG="$2"; artifact_ingress_publish_reviewed_nix_cache_config; test "$VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG" = "$2"',
      "artifact-ingress-test",
      ingressScript,
      reviewed,
    ],
    { encoding: "utf8" },
  );
  assert.equal(trusted.status, 0, trusted.stderr);

  const untrusted = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=hostile VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_DEVSHELL_ARTIFACT_WAS_SET_NIX_CONFIG=1 VBR_DEVSHELL_ARTIFACT_VALUE_NIX_CONFIG="$2"; artifact_ingress_publish_reviewed_nix_cache_config; test -z "${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}"; test -z "${VBR_NIX_CACHE_HEALTH_APPLIED:-}"',
      "artifact-ingress-test",
      ingressScript,
      reviewed,
    ],
    { encoding: "utf8" },
  );
  assert.equal(untrusted.status, 0, untrusted.stderr);
});
