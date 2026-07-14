#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { repairGeneratedWorkspaceLock } from "../../lib/workspace-lock-repair";
import {
  execReturning,
  lock,
  VALID_NAR_HASH,
  withWorkspace,
  writeLock,
} from "./workspace-lock-repair.test-helpers";

test("workspace lock repair no-ops when candidate lock is unchanged", async () => {
  await withWorkspace("vbr-lock-fresh", async (workspace, lockFile) => {
    const current = lock(workspace, "sha256-old");
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: { execFile: execReturning(current) },
    });

    assert.deepEqual(result, { status: "fresh" });
    assert.deepEqual(JSON.parse(await fsp.readFile(lockFile, "utf8")), current);
  });
});

test("workspace lock repair normalizes generated flake local viberoots url", async () => {
  await withWorkspace("vbr-flake-input", async (workspace, lockFile) => {
    const source = path.join(workspace, "viberoots");
    const staleSource = path.join(path.dirname(workspace), "other", "viberoots");
    const current = lock(workspace, "sha256-old");
    await writeLock(lockFile, current);
    await fsp.writeFile(
      path.join(workspace, ".viberoots", "workspace", "flake.nix"),
      `{ inputs.viberoots.url = "path:${staleSource}"; outputs = _: {}; }\n`,
      "utf8",
    );

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: { execFile: execReturning(current) },
    });

    assert.deepEqual(result, { status: "repaired", changedInput: "viberoots" });
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      new RegExp(`viberoots\\.url = "path:${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}";`),
    );
  });
});

test("workspace lock repair preserves an explicit flake input over a visible checkout", async () => {
  await withWorkspace("vbr-explicit-flake-input", async (workspace, lockFile) => {
    const explicitInput = path.join(workspace, "immutable-input");
    await fsp.mkdir(path.join(explicitInput, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(path.join(explicitInput, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(
      path.join(explicitInput, "build-tools", "tools", "dev", "zx-init.mjs"),
      "\n",
    );
    process.env.VIBEROOTS_FLAKE_INPUT_ROOT = explicitInput;
    const current = lock(workspace, "sha256-old");
    const candidate = lock(workspace, VALID_NAR_HASH);
    candidate.nodes.viberoots.locked.path = explicitInput;
    candidate.nodes.viberoots.original.path = explicitInput;
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: { execFile: execReturning(candidate) },
    });

    assert.deepEqual(result, { status: "repaired", changedInput: "viberoots" });
    assert.match(
      await fsp.readFile(path.join(workspace, ".viberoots", "workspace", "flake.nix"), "utf8"),
      new RegExp(
        `viberoots\\.url = "path:${explicitInput.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}";`,
      ),
    );
    const repaired = JSON.parse(await fsp.readFile(lockFile, "utf8"));
    assert.equal(repaired.nodes.viberoots.locked.path, explicitInput);
    assert.equal(repaired.nodes.viberoots.original.path, explicitInput);
  });
});

test("workspace lock repair writes candidate when only viberoots input changed", async () => {
  await withWorkspace("vbr-lock-repair", async (workspace, lockFile) => {
    const current = lock(workspace, "sha256-old");
    const candidate = lock(workspace, "sha256-new");
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: { execFile: execReturning(candidate) },
    });

    assert.deepEqual(result, { status: "repaired", changedInput: "viberoots" });
    assert.deepEqual(JSON.parse(await fsp.readFile(lockFile, "utf8")), candidate);
  });
});

test("workspace lock repair normalizes stale viberoots original path", async () => {
  await withWorkspace("vbr-lock-original", async (workspace, lockFile) => {
    const source = path.join(workspace, "viberoots");
    const staleSource = path.join(path.dirname(workspace), "other", "viberoots");
    const current = lock(workspace, "sha256-old");
    const candidate = lock(workspace, "sha256-old");
    current.nodes.viberoots.original.path = staleSource;
    candidate.nodes.viberoots.original.path = staleSource;
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: { execFile: execReturning(candidate) },
    });

    assert.deepEqual(result, { status: "repaired", changedInput: "viberoots" });
    const repaired = JSON.parse(await fsp.readFile(lockFile, "utf8"));
    assert.equal(repaired.nodes.viberoots.locked.path, source);
    assert.equal(repaired.nodes.viberoots.original.path, source);
  });
});

test("workspace lock repair dry-run reports stale viberoots input without mutation", async () => {
  await withWorkspace("vbr-lock-dry", async (workspace, lockFile) => {
    const current = lock(workspace, "sha256-old");
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      dryRun: true,
      deps: { execFile: execReturning(lock(workspace, "sha256-new")) },
    });

    assert.deepEqual(result, { status: "would-repair", reason: "stale-viberoots-input" });
    assert.deepEqual(JSON.parse(await fsp.readFile(lockFile, "utf8")), current);
  });
});

test("workspace lock repair refuses candidate that changes another input", async () => {
  await withWorkspace("vbr-lock-refuse", async (workspace, lockFile) => {
    const current = lock(workspace, "sha256-old");
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: { execFile: execReturning(lock(workspace, "sha256-new", "sha256-new-nixpkgs")) },
    });

    assert.deepEqual(result, {
      status: "skipped",
      reason: "candidate-changed-non-viberoots-inputs",
    });
    assert.deepEqual(JSON.parse(await fsp.readFile(lockFile, "utf8")), current);
  });
});

test("workspace lock repair honors skip environment", async () => {
  await withWorkspace("vbr-lock-skip", async (workspace, lockFile) => {
    await writeLock(lockFile, lock(workspace, "sha256-old"));
    const previous = process.env.VBR_SKIP_WORKSPACE_LOCK_REPAIR;
    process.env.VBR_SKIP_WORKSPACE_LOCK_REPAIR = "1";
    try {
      const result = await repairGeneratedWorkspaceLock({
        workspaceRoot: workspace,
        deps: {
          execFile: async () => {
            throw new Error("metadata should not run");
          },
        },
      });
      assert.deepEqual(result, { status: "skipped", reason: "disabled" });
    } finally {
      if (previous === undefined) delete process.env.VBR_SKIP_WORKSPACE_LOCK_REPAIR;
      else process.env.VBR_SKIP_WORKSPACE_LOCK_REPAIR = previous;
    }
  });
});
