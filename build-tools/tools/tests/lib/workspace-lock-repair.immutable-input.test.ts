#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  generatedWorkspaceViberootsAuthority,
  repairGeneratedWorkspaceLock,
} from "../../lib/workspace-lock-repair";
import {
  execReturning,
  lock,
  VALID_NAR_HASH,
  withWorkspace,
  writeLock,
} from "./workspace-lock-repair.test-helpers";

test("workspace lock repair skips metadata for a matching immutable input", async () => {
  await withWorkspace("vbr-immutable-input-fresh", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const immutableInput = `/nix/store/${"0".repeat(32)}-source`;
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:${immutableInput}"; outputs = _: {}; }\n`,
    );
    const current = lock(workspace, VALID_NAR_HASH);
    current.nodes.viberoots.locked.path = immutableInput;
    current.nodes.viberoots.original.path = immutableInput;
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: {
        viberootsSource: immutableInput,
        immutableSourceAccessible: () => true,
        execFile: async () => {
          throw new Error("metadata should not run for a matching immutable input");
        },
      },
    });

    assert.deepEqual(result, { status: "fresh" });
    assert.deepEqual(JSON.parse(await fsp.readFile(lockFile, "utf8")), current);
  });
});

test("workspace lock repair replaces a relative lock when the flake declares an immutable input", async () => {
  await withWorkspace("vbr-relative-lock-immutable-flake", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const immutableInput = `/nix/store/${"5".repeat(32)}-source`;
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:${immutableInput}"; outputs = _: {}; }\n`,
    );
    const current = lock(workspace, VALID_NAR_HASH);
    current.nodes.viberoots.locked = {
      type: "path",
      path: "./viberoots-flake-input",
    };
    current.nodes.viberoots.original = {
      type: "path",
      path: "./viberoots-flake-input",
    };
    current.nodes.viberoots.parent = [];
    const candidate = lock(workspace, VALID_NAR_HASH);
    candidate.nodes.viberoots.locked.path = immutableInput;
    candidate.nodes.viberoots.original.path = immutableInput;
    await writeLock(lockFile, current);

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: {
        viberootsSource: immutableInput,
        immutableSourceAccessible: () => true,
        execFile: execReturning(candidate),
      },
    });

    assert.deepEqual(result, { status: "repaired", changedInput: "viberoots" });
    assert.deepEqual(JSON.parse(await fsp.readFile(lockFile, "utf8")), candidate);
  });
});

test("generated workspace authority accepts only a coherent immutable input", async () => {
  await withWorkspace("vbr-immutable-authority", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const immutableInput = `/nix/store/${"3".repeat(32)}-source`;
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:${immutableInput}"; outputs = _: {}; }\n`,
    );
    const current = lock(workspace, VALID_NAR_HASH);
    current.nodes.viberoots.locked.path = immutableInput;
    current.nodes.viberoots.original.path = immutableInput;
    await writeLock(lockFile, current);

    assert.deepEqual(await generatedWorkspaceViberootsAuthority(workspace, () => true), {
      kind: "immutable",
      source: immutableInput,
    });

    current.nodes.viberoots.original.path = `/nix/store/${"4".repeat(32)}-source`;
    await writeLock(lockFile, current);
    assert.deepEqual(await generatedWorkspaceViberootsAuthority(workspace, () => true), {
      kind: "invalid",
    });
  });
});

test("generated workspace authority accepts a consistently remote lock", async () => {
  await withWorkspace("vbr-remote-authority", async (workspace, lockFile) => {
    const current = lock(workspace, VALID_NAR_HASH);
    current.nodes.viberoots.locked = {
      type: "github",
      owner: "viberoots",
      repo: "viberoots",
      rev: "a".repeat(40),
      narHash: VALID_NAR_HASH,
    };
    current.nodes.viberoots.original = {
      type: "github",
      owner: "viberoots",
      repo: "viberoots",
    };
    await writeLock(lockFile, current);

    assert.deepEqual(await generatedWorkspaceViberootsAuthority(workspace), { kind: "remote" });
  });
});

test("workspace lock repair uses metadata when an immutable input is missing its hash", async () => {
  await withWorkspace("vbr-immutable-input-stale", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const immutableInput = `/nix/store/${"1".repeat(32)}-source`;
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:${immutableInput}"; outputs = _: {}; }\n`,
      "utf8",
    );
    const current = lock(workspace, "sha256-unused");
    current.nodes.viberoots.locked = { type: "path", path: immutableInput };
    current.nodes.viberoots.original = { type: "path", path: immutableInput };
    const repairedHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const candidate = lock(workspace, repairedHash);
    candidate.nodes.viberoots.locked.path = immutableInput;
    candidate.nodes.viberoots.original.path = immutableInput;
    await writeLock(lockFile, current);
    let metadataCalls = 0;

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: {
        viberootsSource: immutableInput,
        immutableSourceAccessible: () => true,
        execFile: async () => {
          metadataCalls += 1;
          return execReturning(candidate)();
        },
      },
    });

    assert.equal(metadataCalls, 1);
    assert.deepEqual(result, { status: "repaired", changedInput: "viberoots" });
    assert.equal(
      JSON.parse(await fsp.readFile(lockFile, "utf8")).nodes.viberoots.locked.narHash,
      repairedHash,
    );
  });
});

test("workspace lock repair uses metadata when an immutable input hash is malformed", async () => {
  await withWorkspace("vbr-immutable-input-malformed", async (workspace, lockFile) => {
    const generated = path.join(workspace, ".viberoots", "workspace");
    const immutableInput = `/nix/store/${"2".repeat(32)}-source`;
    await fsp.writeFile(
      path.join(generated, "flake.nix"),
      `{ inputs.viberoots.url = "path:${immutableInput}"; outputs = _: {}; }\n`,
      "utf8",
    );
    const current = lock(workspace, "sha256-abc=");
    current.nodes.viberoots.locked.path = immutableInput;
    current.nodes.viberoots.original.path = immutableInput;
    const candidate = lock(workspace, VALID_NAR_HASH);
    candidate.nodes.viberoots.locked.path = immutableInput;
    candidate.nodes.viberoots.original.path = immutableInput;
    await writeLock(lockFile, current);
    let metadataCalls = 0;

    const result = await repairGeneratedWorkspaceLock({
      workspaceRoot: workspace,
      deps: {
        viberootsSource: immutableInput,
        immutableSourceAccessible: () => true,
        execFile: async () => {
          metadataCalls += 1;
          return execReturning(candidate)();
        },
      },
    });

    assert.equal(metadataCalls, 1);
    assert.deepEqual(result, { status: "repaired", changedInput: "viberoots" });
  });
});
