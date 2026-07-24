#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readOverrideMap, setOverride } from "../../patch/dev-overrides";
import {
  applyWorkspaceWorkflow,
  interruptWorkspaceWorkflow,
  resetWorkspaceWorkflow,
  startWorkspaceWorkflow,
} from "../../patch/lib/workspace-workflow";
import { runSession } from "../../patch/lib/session";
import { getSession, setSession } from "../../patch/state";

const envName = "NIX_RUST_DEV_OVERRIDE_JSON";

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-cleanup-"));
  const origin = path.join(root, "origin");
  const workspace = path.join(root, "workspace");
  await Promise.all([
    fsp.mkdir(origin, { recursive: true }),
    fsp.mkdir(workspace, { recursive: true }),
  ]);
  await fsp.writeFile(path.join(origin, "lib.rs"), "old\n");
  await fsp.writeFile(path.join(workspace, "lib.rs"), "new\n");
  return { root, origin, workspace };
}

async function withRoot(
  body: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
): Promise<void> {
  const value = await fixture();
  const previousRoot = process.env.WORKSPACE_ROOT;
  const previousOverride = process.env[envName];
  process.env.WORKSPACE_ROOT = value.root;
  process.env[envName] = "{}";
  try {
    await body(value);
  } finally {
    if (previousRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = previousRoot;
    if (previousOverride === undefined) delete process.env[envName];
    else process.env[envName] = previousOverride;
    await fsp.rm(value.root, { recursive: true, force: true });
  }
}

test("Rust reset, interruption, and missing-session apply clear override/session state", async () => {
  await withRoot(async ({ root, origin, workspace }) => {
    const key = "dep@1.0.0#registry+https://registry.example/index";
    setOverride(envName, key, path.join(root, "stale"));
    await resetWorkspaceWorkflow({ lang: "rust", key, overrideEnvName: envName });
    assert.deepEqual(readOverrideMap(envName), {});
    assert.equal(await getSession("rust", key), null);
    await setSession("rust", key, {
      importPath: "dep",
      version: "1.0.0",
      originPath: origin,
      workspacePath: workspace,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerPid: process.pid,
    });
    setOverride(envName, key, workspace);
    await interruptWorkspaceWorkflow({ lang: "rust", key, overrideEnvName: envName });
    assert.deepEqual(readOverrideMap(envName), {});
    assert.equal(await getSession("rust", key), null);
    await fsp.access(workspace);
    setOverride(envName, key, path.join(root, "stale"));
    await assert.rejects(
      applyWorkspaceWorkflow({
        lang: "rust",
        key,
        missingSessionError: "missing Rust session",
        overrideEnvName: envName,
        patchPathAbs: path.join(root, "patches/rust/dep.patch"),
        verifyMode: "rust",
        verifySubjectLabel: "Crate",
        verifySubjectValue: key,
        forceWrite: false,
        skipVerify: true,
      }),
      /missing Rust session/,
    );
    assert.deepEqual(readOverrideMap(envName), {});
    assert.equal(await getSession("rust", key), null);
  });
});

test("Rust atomic write and editor failures clear state but preserve inspectable workspace", async () => {
  await withRoot(async ({ root, origin, workspace }) => {
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
    await assert.rejects(
      applyWorkspaceWorkflow({
        lang: "rust",
        key,
        missingSessionError: "missing",
        overrideEnvName: envName,
        patchPathAbs: path.join(root, "patches/rust/dep.patch"),
        verifyMode: "rust",
        verifySubjectLabel: "Crate",
        verifySubjectValue: key,
        forceWrite: false,
        skipVerify: true,
        deps: {
          makeUnifiedDiff: async () => "diff --git a/lib.rs b/lib.rs\n",
          writePatchIfChanged: async () => {
            throw new Error("atomic write failed");
          },
        },
      }),
      /atomic write failed/,
    );
    assert.deepEqual(readOverrideMap(envName), {});
    assert.equal(await getSession("rust", key), null);
    await fsp.access(workspace);

    const previousEditor = process.env.PATCH_EDITOR;
    process.env.PATCH_EDITOR = "exit 23";
    try {
      await assert.rejects(
        startWorkspaceWorkflow({
          lang: "rust",
          key,
          importPath: "dep",
          version: "1.0.0",
          originPath: origin,
          overrideEnvName: envName,
          echoSnippetEnv: "PATCH_RUST_ECHO_SNIPPET",
          moduleKeyForWorkspace: key,
          deps: { makeWorkspace: async () => workspace },
        }),
        /PATCH_EDITOR exited with code 23/,
      );
    } finally {
      if (previousEditor === undefined) delete process.env.PATCH_EDITOR;
      else process.env.PATCH_EDITOR = previousEditor;
    }
    assert.deepEqual(readOverrideMap(envName), {});
    assert.equal(await getSession("rust", key), null);
    await fsp.access(workspace);
  });
});

test("Rust session apply/reset controls propagate failures and stale owner cleanup preserves workspace", async () => {
  await withRoot(async ({ root, origin, workspace }) => {
    const previousAuto = process.env.PATCH_SESSION_AUTO;
    try {
      let action = "";
      process.env.PATCH_SESSION_AUTO = "apply";
      await runSession(
        async () => {
          action = "apply";
        },
        async () => {
          action = "reset";
        },
      );
      assert.equal(action, "apply");
      process.env.PATCH_SESSION_AUTO = "reset";
      await runSession(
        async () => {
          action = "apply";
        },
        async () => {
          action = "reset";
        },
      );
      assert.equal(action, "reset");
      process.env.PATCH_SESSION_AUTO = "apply";
      await assert.rejects(
        runSession(
          async () => {
            throw new Error("apply interrupted");
          },
          async () => {},
        ),
        /apply interrupted/,
      );
    } finally {
      if (previousAuto === undefined) delete process.env.PATCH_SESSION_AUTO;
      else process.env.PATCH_SESSION_AUTO = previousAuto;
    }

    let control = "";
    const ctrlD = runSession(
      async () => {
        control = "apply";
      },
      async () => {
        control = "reset";
      },
    );
    setImmediate(() => process.stdin.emit("data", Buffer.from("\u0004")));
    await ctrlD;
    assert.equal(control, "apply");
    const ctrlC = runSession(
      async () => {
        control = "apply";
      },
      async () => {
        control = "reset";
      },
    );
    setImmediate(() => process.stdin.emit("data", Buffer.from("\u0003")));
    await ctrlC;
    assert.equal(control, "reset");

    const key = "dead@1.0.0#registry+https://registry.example/index";
    await setSession("rust", key, {
      importPath: "dead",
      version: "1.0.0",
      originPath: origin,
      workspacePath: workspace,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerPid: 2_147_483_647,
    });
    setOverride(envName, key, workspace);
    const replacement = path.join(root, "replacement");
    await fsp.mkdir(replacement);
    await startWorkspaceWorkflow({
      lang: "rust",
      key,
      importPath: "dead",
      version: "1.0.0",
      originPath: origin,
      overrideEnvName: envName,
      echoSnippetEnv: "PATCH_RUST_ECHO_SNIPPET",
      moduleKeyForWorkspace: key,
      deps: { makeWorkspace: async () => replacement },
    });
    assert.equal((await getSession("rust", key))?.workspacePath, replacement);
    await fsp.access(workspace);
  });
});
