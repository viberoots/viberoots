#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveProjectScanContext } from "../../lib/repo";

test("project scan context keeps consumer authority across supported source layouts", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-scan-context-"));
  await fsp.mkdir(path.join(root, "projects"), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots/workspace"), { recursive: true });
  await fsp.writeFile(path.join(root, ".viberoots/workspace/flake.nix"), "{}\n");
  const canonicalRoot = await fsp.realpath(root);
  const target = "workspace_buck//:project_enforcement_stale_names";
  const localSource = path.join(root, "viberoots");
  await fsp.mkdir(localSource);
  for (const [start, viberootsRoot, sourceMode] of [
    [root, localSource, "local"],
    [
      path.join(root, ".viberoots/workspace"),
      "/nix/store/00000000000000000000000000000000-viberoots-source",
      "remote",
    ],
  ] as const) {
    const context = resolveProjectScanContext({
      start,
      env: { WORKSPACE_ROOT: root, VIBEROOTS_ROOT: viberootsRoot, BUCK_TEST_TARGET: target },
    });
    assert.equal(context.workspaceRoot, canonicalRoot);
    assert.equal(context.projectsRoot, path.join(canonicalRoot, "projects"));
    assert.equal(context.sourceMode, sourceMode);
    assert.equal(
      context.viberootsRoot,
      sourceMode === "local" ? await fsp.realpath(viberootsRoot) : viberootsRoot,
    );
  }
});

test("project scan context fails closed without generated execution or projects", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-scan-context-invalid-"));
  await fsp.mkdir(path.join(root, ".viberoots/workspace"), { recursive: true });
  await fsp.writeFile(path.join(root, ".viberoots/workspace/flake.nix"), "{}\n");
  assert.throws(
    () => resolveProjectScanContext({ start: root, env: { WORKSPACE_ROOT: root } }),
    /project scan root is unavailable/,
  );
  await fsp.mkdir(path.join(root, "projects"));
  assert.throws(
    () => resolveProjectScanContext({ start: root, env: { WORKSPACE_ROOT: root } }),
    /generated workspace_buck execution evidence/,
  );
});
