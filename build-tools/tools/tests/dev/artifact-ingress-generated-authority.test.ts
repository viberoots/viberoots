#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

const ingressScript = viberootsSourcePath("build-tools/tools/bin/artifact-ingress-env.sh");

test("shell ingress prefers explicit enclosing WORKSPACE_ROOT envrc over nested cwd envrc", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-ingress-workspace-root-"));
  const tools = path.join(workspace, "tools");
  const nested = path.join(workspace, "viberoots");
  try {
    fs.mkdirSync(path.join(tools, "bin"), { recursive: true });
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(workspace, ".envrc"), "parent\n");
    fs.writeFileSync(path.join(nested, ".envrc"), "nested\n");
    fs.writeFileSync(path.join(tools, "bin", "direnv"), '#!/bin/bash\nprintf "%s\\n" "$*"\n', {
      mode: 0o755,
    });
    const result = spawnSync(
      "/bin/bash",
      [
        "-c",
        '. "$1"; artifact_ingress_tools_root() { printf "%s\\n" "$FAKE_TOOLS"; }; cd "$3"; export WORKSPACE_ROOT="$2"; artifact_ingress_reexec_with_devshell /bin/echo ok',
        "artifact-ingress-test",
        ingressScript,
        workspace,
        nested,
        tools,
      ],
      { encoding: "utf8", env: { ...process.env, FAKE_TOOLS: tools } },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `exec ${fs.realpathSync(workspace)} /bin/echo ok`);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("shell ingress keeps trusted generated artifact authority for generated-authority wrappers", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; export VBR_DEVSHELL_USE_GENERATED_AUTHORITY=1 VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1 VBR_ARTIFACT_INGRESS_WAS_SET_VBR_ARTIFACT_TOOLS_ROOT=1 VBR_ARTIFACT_INGRESS_VALUE_VBR_ARTIFACT_TOOLS_ROOT=/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-stale-tools VBR_DEVSHELL_ARTIFACT_WAS_SET_VBR_ARTIFACT_TOOLS_ROOT=1 VBR_DEVSHELL_ARTIFACT_VALUE_VBR_ARTIFACT_TOOLS_ROOT=/nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-generated-tools VBR_ARTIFACT_INGRESS_WAS_SET_WORKSPACE_ROOT=1 VBR_ARTIFACT_INGRESS_VALUE_WORKSPACE_ROOT=/tmp/workspace VBR_DEVSHELL_ARTIFACT_WAS_SET_WORKSPACE_ROOT=1 VBR_DEVSHELL_ARTIFACT_VALUE_WORKSPACE_ROOT=/tmp/workspace; artifact_ingress_restore_or_remove_selectors; test "$VBR_ARTIFACT_TOOLS_ROOT" = /nix/store/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-generated-tools; test "$WORKSPACE_ROOT" = /tmp/workspace',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("shell ingress clear preserves selected workspace root for generated-authority wrappers", () => {
  const result = spawnSync(
    "/bin/bash",
    [
      "-c",
      '. "$1"; export VBR_DEVSHELL_USE_GENERATED_AUTHORITY=1 VBR_ARTIFACT_INGRESS_VALUE_WORKSPACE_ROOT=/tmp/workspace WORKSPACE_ROOT=/tmp/workspace VBR_ARTIFACT_TOOLS_ROOT=/nix/store/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-stale-tools; artifact_ingress_clear_selectors; test "$WORKSPACE_ROOT" = /tmp/workspace; test -z "${VBR_ARTIFACT_TOOLS_ROOT:-}"',
      "artifact-ingress-test",
      ingressScript,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});
