#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ingressScript = "viberoots/build-tools/tools/bin/artifact-ingress-env.sh";

function writeManifest(workspace: string, root: string): void {
  const manifest = path.join(workspace, ".viberoots", "workspace", "toolchain-paths.json");
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(manifest, `${JSON.stringify({ artifactTools: { root } })}\n`);
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
