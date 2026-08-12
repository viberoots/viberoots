#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const ingressScript = "viberoots/build-tools/tools/bin/artifact-ingress-env.sh";

test("shell ingress restores caller language selectors that differ from trusted baseline", () => {
  for (const name of ["CC", "PYTHONPATH", "RUSTFLAGS", "GOFLAGS"]) {
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

test("verified ingress removes Nix target selectors contributed by the devshell", () => {
  const names = [
    "NIX_BINTOOLS_FOR_TARGET",
    "NIX_BINTOOLS_WRAPPER_TARGET_TARGET_arm64_apple_darwin",
    "NIX_CC_FOR_TARGET",
    "NIX_CC_WRAPPER_TARGET_TARGET_arm64_apple_darwin",
    "NIX_CFLAGS_COMPILE_FOR_TARGET",
    "NIX_LDFLAGS_FOR_TARGET",
  ];
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; shift; for name in "$@"; do export "${name}=/nix/store/devshell"; done; artifact_ingress_capture_environment; artifact_ingress_record_devshell_selectors; artifact_ingress_clear_selectors; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1; artifact_ingress_restore_or_remove_selectors; for name in "$@"; do ! declare -p "$name" >/dev/null 2>&1 || exit 1; done',
      "artifact-ingress-test",
      ingressScript,
      ...names,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("verified ingress removes stale Nix toolchain selectors across a devshell refresh", () => {
  const names = [
    "NIX_BINTOOLS_FOR_TARGET",
    "NIX_BINTOOLS_WRAPPER_TARGET_TARGET_arm64_apple_darwin",
    "NIX_CC_FOR_TARGET",
    "NIX_CC_WRAPPER_TARGET_TARGET_arm64_apple_darwin",
    "NIX_CFLAGS_COMPILE_FOR_TARGET",
    "NIX_LDFLAGS",
    "NIX_LDFLAGS_FOR_TARGET",
  ];
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; shift; for name in "$@"; do export "${name}=/nix/store/old-devshell"; done; artifact_ingress_capture_environment; for name in "$@"; do export "${name}=/nix/store/new-devshell"; done; artifact_ingress_record_devshell_selectors; artifact_ingress_clear_selectors; export VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1; artifact_ingress_restore_or_remove_selectors; for name in "$@"; do ! declare -p "$name" >/dev/null 2>&1 || exit 1; done',
      "artifact-ingress-test",
      ingressScript,
      ...names,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("verified ingress removes Nix target selectors introduced after capture", () => {
  const names = [
    "NIX_BINTOOLS_FOR_TARGET",
    "NIX_BINTOOLS_WRAPPER_TARGET_TARGET_arm64_apple_darwin",
    "NIX_CC_FOR_TARGET",
    "NIX_CC_WRAPPER_TARGET_TARGET_arm64_apple_darwin",
    "NIX_CFLAGS_COMPILE_FOR_TARGET",
    "NIX_LDFLAGS_FOR_TARGET",
  ];
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; shift; artifact_ingress_capture_environment; for name in "$@"; do export "${name}=/nix/store/selected-devshell"; done; artifact_ingress_restore_or_remove_selectors; for name in "$@"; do ! declare -p "$name" >/dev/null 2>&1 || exit 1; done',
      "artifact-ingress-test",
      ingressScript,
      ...names,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
