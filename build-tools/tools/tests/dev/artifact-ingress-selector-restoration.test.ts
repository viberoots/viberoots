#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ingressScript = "viberoots/build-tools/tools/bin/artifact-ingress-env.sh";

test("shell ingress removes canonicalized session inputs before canonical admission", () => {
  for (const name of [
    "NIX_CFLAGS_COMPILE",
    "NIX_PROFILES",
    "NIX_USER_PROFILE_DIR",
    "NODE_PATH",
    "XPC_FLAGS",
  ]) {
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; name="$2"; printf -v "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" %s 1; printf -v "VBR_ARTIFACT_INGRESS_VALUE_${name}" %s /host/value; export "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" "VBR_ARTIFACT_INGRESS_VALUE_${name}"; artifact_ingress_restore_or_remove_selectors; ! declare -p "$name" >/dev/null 2>&1',
        "artifact-ingress-test",
        ingressScript,
        name,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("shell ingress removes the ordinary devshell flake input selector", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; name=VIBEROOTS_FLAKE_INPUT_ROOT; printf -v "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" %s 1; printf -v "VBR_ARTIFACT_INGRESS_VALUE_${name}" %s /workspace/generated-input; printf -v "VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}" %s 1; printf -v "VBR_DEVSHELL_ARTIFACT_VALUE_${name}" %s /workspace/generated-input; export "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" "VBR_ARTIFACT_INGRESS_VALUE_${name}" "VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}" "VBR_DEVSHELL_ARTIFACT_VALUE_${name}"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1; artifact_ingress_restore_or_remove_selectors; test -z "${VIBEROOTS_FLAKE_INPUT_ROOT:-}"',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("verified ingress removes baseline Nix config and source root before canonical admission", () => {
  for (const [name, value] of [
    ["NIX_CONFIG", "builders ="],
    ["VIBEROOTS_ROOT", "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source"],
  ]) {
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; name="$2"; expected="$3"; printf -v "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" %s 1; printf -v "VBR_ARTIFACT_INGRESS_VALUE_${name}" %s "$expected"; printf -v "VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}" %s 1; printf -v "VBR_DEVSHELL_ARTIFACT_VALUE_${name}" %s "$expected"; export "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" "VBR_ARTIFACT_INGRESS_VALUE_${name}" "VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}" "VBR_DEVSHELL_ARTIFACT_VALUE_${name}"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1; artifact_ingress_restore_or_remove_selectors; ! declare -p "$name" >/dev/null 2>&1',
        "artifact-ingress-test",
        ingressScript,
        name,
        value,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});

test("verify preserves only reviewed cache proof after removing restored ambient roots", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; for name in NIX_CONFIG VIBEROOTS_ROOT; do printf -v "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" %s 1; printf -v "VBR_ARTIFACT_INGRESS_VALUE_${name}" %s hostile; printf -v "VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}" %s 1; printf -v "VBR_DEVSHELL_ARTIFACT_VALUE_${name}" %s baseline; export "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" "VBR_ARTIFACT_INGRESS_VALUE_${name}" "VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}" "VBR_DEVSHELL_ARTIFACT_VALUE_${name}"; done; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY=auto NIX_CONFIG=reviewed; artifact_ingress_publish_reviewed_nix_cache_config; artifact_ingress_restore_or_remove_selectors; artifact_ingress_clear_selectors; test -z "${NIX_CONFIG:-}${VIBEROOTS_ROOT:-}"; test "$VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG" = reviewed',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("reviewed cache ingress removes only the exact bound Nix config", () => {
  for (const [captured, expected] of [
    ["reviewed", ""],
    ["hostile", "hostile"],
  ]) {
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; export VBR_ARTIFACT_INGRESS_WAS_SET_NIX_CONFIG=1 VBR_ARTIFACT_INGRESS_VALUE_NIX_CONFIG="$2" VBR_DEVSHELL_ARTIFACT_WAS_SET_NIX_CONFIG=1 VBR_DEVSHELL_ARTIFACT_VALUE_NIX_CONFIG=baseline VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=reviewed; artifact_ingress_restore_or_remove_selectors; test "${NIX_CONFIG:-}" = "$3"',
        "artifact-ingress-test",
        ingressScript,
        captured,
        expected,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${captured}: ${result.stderr}`);
  }
});

test("proof-bound NIX_CONFIG is removed after canonical netrc augmentation", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; captured="substituters = https://cache.nixos.org/"; encoded="$(printf %s "$captured" | base64 | tr -d "\\n")"; export VBR_ARTIFACT_INGRESS_WAS_SET_NIX_CONFIG=1 VBR_ARTIFACT_INGRESS_VALUE_NIX_CONFIG="$captured" VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG="$captured"$\'\\n\'"netrc-file = $1" VBR_NIX_CACHE_ROLE_AUTHORITY=verify-nested-v1 VBR_NIX_CACHE_ROLE_CONFIG_B64="$encoded"; artifact_ingress_restore_or_remove_selectors; test -z "${NIX_CONFIG:-}"',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("proof-bound cache refresh restores captured config instead of historical source config", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_NIX_CACHE_ROLE_AUTHORITY=verify-nested-v1 VBR_NIX_CACHE_ROLE_CONFIG_B64=cmV2aWV3ZWQ= VBR_ARTIFACT_INGRESS_WAS_SET_NIX_CONFIG=1 VBR_ARTIFACT_INGRESS_VALUE_NIX_CONFIG=reviewed VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG=historical; env_apply_nix_cache_health() { test "$NIX_CONFIG" = reviewed; export VBR_NIX_CACHE_HEALTH_APPLIED=1; }; artifact_ingress_refresh_nix_cache_health; test "$NIX_CONFIG" = reviewed',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("reviewed cache refresh does not restore historical pre-degradation config", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG=reviewed VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG=historical; env_apply_nix_cache_health() { test "$NIX_CONFIG" = reviewed; export VBR_NIX_CACHE_HEALTH_APPLIED=1; }; artifact_ingress_refresh_nix_cache_health; test "$NIX_CONFIG" = reviewed',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("proof-bound cache refresh preserves substituters before validating the bound config", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; config="substituters = https://cache.nixos.org/"; encoded="$(printf %s "$config" | base64 | tr -d "\\n")"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_NIX_CACHE_ROLE_AUTHORITY=verify-nested-v1 VBR_NIX_CACHE_ROLE_CONFIG_B64="$encoded"; env_strip_nix_cache_overrides() { printf %s "builders ="; }; env_apply_nix_cache_health() { test "$NIX_CONFIG" = "$config"; export VBR_NIX_CACHE_HEALTH_APPLIED=1; }; artifact_ingress_refresh_nix_cache_health; test "$NIX_CONFIG" = "$config"',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("proof-bound cache refresh validates before adding the canonical netrc", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; config="substituters = https://cache.nixos.org/"; encoded="$(printf %s "$config" | base64 | tr -d "\\n")"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_NIX_CACHE_ROLE_AUTHORITY=verify-nested-v1 VBR_NIX_CACHE_ROLE_CONFIG_B64="$encoded" VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE="$1"; env_apply_nix_cache_health() { test "$NIX_CONFIG" = "$config"; export VBR_NIX_CACHE_HEALTH_APPLIED=1 VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG="$NIX_CONFIG"; }; artifact_ingress_refresh_nix_cache_health; test "$NIX_CONFIG" = "$config"$\'\\n\'"netrc-file = $1"; test "$VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG" = "$NIX_CONFIG"',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("canonical proof publication consumes nested cache role authority", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; export VBR_NIX_CACHE_ROLE_AUTHORITY=verify-nested-v1 VBR_NIX_CACHE_ROLE_REQUIRED=required VBR_NIX_CACHE_ROLE_OPTIONAL=optional VBR_NIX_CACHE_ROLE_POLICY=auto VBR_NIX_CACHE_ROLE_BINDING=binding VBR_NIX_CACHE_ROLE_CONFIG_B64=Y29uZmln; artifact_ingress_consume_nested_cache_role_authority; test -z "${VBR_NIX_CACHE_ROLE_AUTHORITY:-}${VBR_NIX_CACHE_ROLE_REQUIRED:-}${VBR_NIX_CACHE_ROLE_OPTIONAL:-}${VBR_NIX_CACHE_ROLE_POLICY:-}${VBR_NIX_CACHE_ROLE_BINDING:-}${VBR_NIX_CACHE_ROLE_CONFIG_B64:-}"',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("shell ingress discards only the historical launcher-owned flake input", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-flake-input-"));
  try {
    const generated = path.join(workspace, ".viberoots", "workspace", "viberoots-flake-input");
    const owned = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; export VIBEROOTS_FLAKE_INPUT_ROOT="$2/.viberoots/workspace/viberoots-flake-input"; artifact_ingress_discard_launcher_owned_flake_input "$2"; test -z "${VIBEROOTS_FLAKE_INPUT_ROOT:-}"',
        "artifact-ingress-test",
        ingressScript,
        workspace,
      ],
      { encoding: "utf8" },
    );
    assert.equal(owned.status, 0, owned.stderr);

    for (const hostileValue of [
      `${generated}-host-override`,
      "/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-source",
      path.join(
        path.dirname(workspace),
        "other-workspace/.viberoots/workspace/viberoots-flake-input",
      ),
    ]) {
      const hostile = spawnSync(
        "/bin/bash",
        [
          "-c",
          '. "$1"; export VIBEROOTS_FLAKE_INPUT_ROOT="$3"; artifact_ingress_discard_launcher_owned_flake_input "$2"; test "$VIBEROOTS_FLAKE_INPUT_ROOT" = "$3"',
          "artifact-ingress-test",
          ingressScript,
          workspace,
          hostileValue,
        ],
        { encoding: "utf8" },
      );
      assert.equal(hostile.status, 0, `${hostileValue}: ${hostile.stderr}`);
    }
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
