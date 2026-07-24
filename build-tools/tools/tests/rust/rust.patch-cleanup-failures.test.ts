#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readOverrideMap } from "../../patch/dev-overrides";
import { applyWorkspaceWorkflow, startWorkspaceWorkflow } from "../../patch/lib/workspace-workflow";
import { getSession } from "../../patch/state";

const envName = "NIX_RUST_DEV_OVERRIDE_JSON";
const key = "dep@1.0.0#registry+https://registry.example/index";

async function fixture() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-rust-cleanup-failures-"));
  const origin = path.join(root, "origin");
  const workspace = path.join(root, "workspace");
  await Promise.all(
    [origin, workspace].map((directory) => fsp.mkdir(directory, { recursive: true })),
  );
  await fsp.writeFile(path.join(origin, "lib.rs"), "old\n");
  await fsp.writeFile(path.join(workspace, "lib.rs"), "new\n");
  return { root, origin, workspace };
}

async function withFixture(
  body: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
): Promise<void> {
  const value = await fixture();
  const previous = {
    root: process.env.WORKSPACE_ROOT,
    override: process.env[envName],
    editor: process.env.PATCH_EDITOR,
    timeout: process.env.PATCH_EDITOR_TIMEOUT_SECS,
  };
  process.env.WORKSPACE_ROOT = value.root;
  process.env[envName] = "{}";
  try {
    await body(value);
  } finally {
    for (const [name, prior] of [
      ["WORKSPACE_ROOT", previous.root],
      [envName, previous.override],
      ["PATCH_EDITOR", previous.editor],
      ["PATCH_EDITOR_TIMEOUT_SECS", previous.timeout],
    ] as const) {
      if (prior === undefined) delete process.env[name];
      else process.env[name] = prior;
    }
    await fsp.rm(value.root, { recursive: true, force: true });
  }
}

test("Rust editor timeout clears state and preserves its inspectable workspace", async () => {
  await withFixture(async ({ origin, workspace }) => {
    process.env.PATCH_EDITOR = `${process.execPath} -e "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"`;
    process.env.PATCH_EDITOR_TIMEOUT_SECS = "0.05";
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
      /PATCH_EDITOR timed out after 0.05 seconds/,
    );
    assert.deepEqual(readOverrideMap(envName), {});
    assert.equal(await getSession("rust", key), null);
    await fsp.access(workspace);
  });
});

test("Rust verification failure clears state and preserves its inspectable workspace", async () => {
  await withFixture(async ({ root, origin, workspace }) => {
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
        skipVerify: false,
        deps: {
          makeUnifiedDiff: async () => "diff --git a/lib.rs b/lib.rs\n",
          verifyPatchDryRun: async () => {
            throw new Error("verification failed");
          },
        },
      }),
      /Patch verification failed.*Crate.*Origin.*Patch/s,
    );
    assert.deepEqual(readOverrideMap(envName), {});
    assert.equal(await getSession("rust", key), null);
    await fsp.access(workspace);
  });
});
