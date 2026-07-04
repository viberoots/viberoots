#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { exportDeploymentResourceGraph } from "../../deployments/resource-graph-export";
import { runViberootsGc } from "../../lib/maintenance-gc";
import {
  DEFAULT_GRAPH_PATH,
  DEFAULT_RESOURCE_GRAPH_NODES_PATH,
  WORKSPACE_RESOURCE_GRAPH_DIR,
} from "../../lib/workspace-state-paths";
import { activateWorkspace } from "../../lib/workspace-activation";
import {
  cloudflareDeployment,
  cloudflareNodes,
} from "../deployments/deployment-contexts.scope.helpers";

test("workspace activation records remote source paths through current symlink", async () => {
  await withTempWorkspace("viberoots-source-remote", async (workspace) => {
    const remoteSource = await fsp.mkdtemp(path.join(os.tmpdir(), "nix-store-source-"));
    try {
      await writeSourceFlake(remoteSource);
      const result = await activate(workspace, remoteSource);
      assert.equal(result.sourcePath, remoteSource);
      assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), remoteSource);
      await assertExportAndGcUseWorkspaceState(workspace);
    } finally {
      await fsp.rm(remoteSource, { recursive: true, force: true });
    }
  });
});

test("workspace activation keeps pre-extraction local source pointed at workspace root", async () => {
  await withTempWorkspace("viberoots-source-local-self", async (workspace) => {
    await writeSourceFlake(path.join(workspace, "viberoots"), {
      text: "viberoots local dogfood flake\nimport ./build-tools/tools/nix/flake/outputs.nix\n",
    });
    const result = await activate(workspace, "viberoots");
    assert.equal(result.currentTarget, "..");
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "..");
    await assertExportAndGcUseWorkspaceState(workspace);
  });
});

test("workspace activation keeps extracted sibling submodule pointed at ../viberoots", async () => {
  await withTempWorkspace("viberoots-source-submodule", async (workspace) => {
    const source = path.join(workspace, "viberoots");
    await writeSourceFlake(source);
    await fsp.mkdir(path.join(source, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(path.join(source, "build-tools", "tools", "dev", "zx-init.mjs"), "");
    await fsp.mkdir(path.join(source, "prelude"), { recursive: true });
    await fsp.mkdir(path.join(source, "toolchains"), { recursive: true });
    const result = await activate(workspace, "viberoots");
    assert.equal(result.currentTarget, "../viberoots");
    assert.equal(await fsp.readlink(path.join(workspace, ".viberoots", "current")), "../viberoots");
    await assertExportAndGcUseWorkspaceState(workspace);
  });
});

async function assertExportAndGcUseWorkspaceState(workspace: string): Promise<void> {
  await writeGraph(workspace);
  const result = await exportDeploymentResourceGraph({ workspaceRoot: workspace });
  assert.equal(result.nodesPath, path.join(workspace, DEFAULT_RESOURCE_GRAPH_NODES_PATH));
  assert.ok(JSON.parse(await fsp.readFile(result.nodesPath, "utf8")));

  const gc = await runViberootsGc({
    workspaceRoot: workspace,
    dryRun: true,
    nix: false,
  });
  assert.ok(
    gc.plan.local.some(
      (entry) =>
        entry.path === WORKSPACE_RESOURCE_GRAPH_DIR &&
        entry.reason === "regenerable resource graph workspace state",
    ),
  );
}

async function writeGraph(workspace: string): Promise<void> {
  const file = path.join(workspace, DEFAULT_GRAPH_PATH);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(
    file,
    `${JSON.stringify(
      cloudflareNodes([
        cloudflareDeployment({
          provider_target: { account: "web-platform", project: "sample-webapp-staging" },
        }),
      ]),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function withTempWorkspace(
  prefix: string,
  run: (workspace: string) => Promise<void>,
): Promise<void> {
  const workspace = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  try {
    await fsp.writeFile(path.join(workspace, ".buckroot"), "");
    await run(workspace);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
}

async function activate(workspace: string, sourcePath: string) {
  return activateWorkspace({
    start: workspace,
    env: { WORKSPACE_ROOT: workspace },
    sourcePath,
    shellEntry: true,
  });
}

async function writeSourceFlake(source: string, opts: { text?: string } = {}): Promise<void> {
  await fsp.mkdir(source, { recursive: true });
  await fsp.writeFile(path.join(source, "flake.nix"), opts.text || "{}\n", "utf8");
}
