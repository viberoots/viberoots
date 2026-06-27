#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { repairGeneratedWorkspaceLock } from "../../lib/workspace-lock-repair";

async function withWorkspace(
  prefix: string,
  fn: (workspace: string, lockFile: string) => Promise<void>,
): Promise<void> {
  const workspace = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), `${prefix}-`)));
  try {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const source = path.join(workspace, "viberoots");
    await fsp.mkdir(path.join(source, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(path.join(source, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    await fsp.writeFile(path.join(source, "build-tools", "tools", "dev", "zx-init.mjs"), "\n");
    await fsp.mkdir(generated, { recursive: true });
    await fsp.writeFile(path.join(generated, "flake.nix"), "{ outputs = _: {}; }\n", "utf8");
    const lockFile = path.join(generated, "flake.lock");
    await fn(workspace, lockFile);
  } finally {
    await fsp.rm(workspace, { recursive: true, force: true });
  }
}

function lock(workspace: string, viberootsHash: string, nixpkgsHash = "sha256-nixpkgs"): any {
  const source = path.join(workspace, "viberoots");
  return {
    nodes: {
      root: { inputs: { nixpkgs: "nixpkgs", viberoots: "viberoots" } },
      nixpkgs: { locked: { type: "github", narHash: nixpkgsHash } },
      viberoots: {
        locked: { type: "path", path: source, narHash: viberootsHash, lastModified: 1 },
        original: { type: "path", path: source },
      },
    },
    root: "root",
    version: 7,
  };
}

async function writeLock(file: string, value: unknown): Promise<void> {
  await fsp.writeFile(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function execReturning(candidate: unknown): any {
  return async () => ({
    stdout: JSON.stringify({ locks: candidate }),
    stderr: "",
  });
}

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
