#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveProjectScanContext } from "../../lib/repo";

test("project scan context resolves supported consumer layouts and fails closed", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "project-scan-context-"));
  await fsp.mkdir(path.join(root, "projects"), { recursive: true });
  await fsp.mkdir(path.join(root, ".viberoots/workspace"), { recursive: true });
  await fsp.writeFile(path.join(root, ".viberoots/workspace/flake.nix"), "{}\n");
  const canonicalRoot = await fsp.realpath(root);
  const target = "workspace_buck//:project_enforcement_stale_names";
  for (const start of [root, path.join(root, ".viberoots/workspace")]) {
    const context = resolveProjectScanContext({
      start,
      env: { WORKSPACE_ROOT: root, BUCK_TEST_TARGET: target },
    });
    assert.equal(context.workspaceRoot, canonicalRoot);
    assert.equal(context.projectsRoot, path.join(canonicalRoot, "projects"));
  }
  assert.throws(
    () => resolveProjectScanContext({ start: root, env: { WORKSPACE_ROOT: root } }),
    /generated workspace_buck execution evidence/,
  );
});
