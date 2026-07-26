#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ingressScript = "viberoots/build-tools/tools/bin/artifact-ingress-env.sh";

test("shell ingress removes trusted devshell session inputs before canonical admission", () => {
  for (const name of ["NIX_CFLAGS_COMPILE", "NIX_PROFILES", "NIX_USER_PROFILE_DIR", "XPC_FLAGS"]) {
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

test("shell ingress restores caller language selectors that differ from trusted baseline", () => {
  for (const name of ["CC", "NODE_PATH", "PYTHONPATH", "RUSTFLAGS", "GOFLAGS"]) {
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; name="$2"; printf -v "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" %s 1; printf -v "VBR_ARTIFACT_INGRESS_VALUE_${name}" %s /host/value; printf -v "VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}" %s 1; printf -v "VBR_DEVSHELL_ARTIFACT_VALUE_${name}" %s /nix/store/value; export "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" "VBR_ARTIFACT_INGRESS_VALUE_${name}" "VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}" "VBR_DEVSHELL_ARTIFACT_VALUE_${name}"; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1; artifact_ingress_restore_or_remove_selectors; test "${!name}" = /host/value',
        "artifact-ingress-test",
        ingressScript,
        name,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});
