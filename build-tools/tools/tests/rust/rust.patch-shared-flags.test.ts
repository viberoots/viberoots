#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readOverrideMap } from "../../patch/dev-overrides";
import {
  applyWorkspaceWorkflow,
  resetWorkspaceWorkflow,
  startWorkspaceWorkflow,
} from "../../patch/lib/workspace-workflow";

test("Rust echo-snippet avoids ambient mutation and force reaches atomic patch writing", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-flags-"));
  const envName = "NIX_RUST_DEV_OVERRIDE_JSON";
  const previousRoot = process.env.WORKSPACE_ROOT;
  const previousOverride = process.env[envName];
  const previousEcho = process.env.PATCH_RUST_ECHO_SNIPPET;
  const oldError = console.error;
  try {
    const origin = path.join(root, "origin");
    const workspace = path.join(root, "workspace");
    await Promise.all([origin, workspace].map((dir) => fsp.mkdir(dir, { recursive: true })));
    await fsp.writeFile(path.join(origin, "lib.rs"), "old\n");
    await fsp.writeFile(path.join(workspace, "lib.rs"), "new\n");
    process.env.WORKSPACE_ROOT = root;
    process.env[envName] = "{}";
    process.env.PATCH_RUST_ECHO_SNIPPET = "1";
    let diagnostics = "";
    console.error = (...values: unknown[]) => {
      diagnostics += `${values.join(" ")}\n`;
    };
    const key = "dep@1.0.0#registry+https://registry.example/index";
    await startWorkspaceWorkflow({
      lang: "rust",
      key,
      importPath: "dep",
      version: "1.0.0",
      originPath: origin,
      overrideEnvName: envName,
      echoSnippetEnv: "PATCH_RUST_ECHO_SNIPPET",
      moduleKeyForWorkspace: key,
      deps: { makeWorkspace: async () => workspace },
    });
    assert.match(diagnostics, /export NIX_RUST_DEV_OVERRIDE_JSON=/);
    assert.deepEqual(readOverrideMap(envName), {});
    let observedForce = false;
    await applyWorkspaceWorkflow({
      lang: "rust",
      key,
      missingSessionError: "missing",
      overrideEnvName: envName,
      patchPathAbs: path.join(root, "patches/rust/dep.patch"),
      verifyMode: "rust",
      verifySubjectLabel: "Crate",
      verifySubjectValue: key,
      forceWrite: true,
      skipVerify: true,
      deps: {
        makeUnifiedDiff: async () => "diff --git a/lib.rs b/lib.rs\n",
        writePatchIfChanged: async (_destination, _diff, force) => {
          observedForce = force;
          return "written";
        },
      },
    });
    assert.equal(observedForce, true);
    await resetWorkspaceWorkflow({ lang: "rust", key, overrideEnvName: envName });
  } finally {
    console.error = oldError;
    for (const [key, value] of [
      ["WORKSPACE_ROOT", previousRoot],
      [envName, previousOverride],
      ["PATCH_RUST_ECHO_SNIPPET", previousEcho],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fsp.rm(root, { recursive: true, force: true });
  }
});
