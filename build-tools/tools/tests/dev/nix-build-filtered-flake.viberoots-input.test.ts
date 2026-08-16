#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  repairSnapshotViberootsInput,
  syncExactViberootsInputs,
} from "../../dev/filtered-flake-viberoots-input";
import {
  filteredFlakeRsyncExcludeArgs,
  selectedNodeSnapshotRelPaths,
  selectedNodeSnapshotRsyncSources,
} from "../../dev/nix-build-filtered-flake-lib";

async function write(root: string, rel: string, content = `${rel}\n`): Promise<void> {
  const file = path.join(root, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, "utf8");
}

test("stale consumer locks acquire exact Rust and Wasmtime inputs without resolution", () => {
  const snapshotLock = {
    nodes: {
      root: {
        inputs: {
          "rust-overlay": "rust-overlay",
          viberoots: "viberoots",
          "wasmtime-nixpkgs": "wasmtime-nixpkgs",
        },
      },
      viberoots: { inputs: { nixpkgs: "nixpkgs" } },
      nixpkgs: { locked: { rev: "consumer" } },
      "rust-overlay": { locked: { rev: "reviewed-overlay" } },
      "wasmtime-nixpkgs": { locked: { rev: "reviewed-wasmtime" } },
    },
    root: "root",
  };
  const sourceLock = {
    nodes: {
      root: {
        inputs: {
          "rust-overlay": "rust-overlay",
          "wasmtime-nixpkgs": "wasmtime-nixpkgs",
        },
      },
      "rust-overlay": {
        inputs: { nixpkgs: ["nixpkgs"] },
        locked: { rev: "rust-overlay-source" },
        original: { owner: "oxalica", repo: "rust-overlay", type: "github" },
      },
      "wasmtime-nixpkgs": {
        locked: {
          rev: "d407951447dcd00442e97087bf374aad70c04cea",
          narHash: "sha256-8i/87eeoqiGE4yOTjwSA3Eh/ziJRQEmd/unYU+K27sk=",
        },
      },
    },
    root: "root",
  };
  syncExactViberootsInputs(snapshotLock, sourceLock);
  assert.deepEqual(snapshotLock.nodes.viberoots.inputs["rust-overlay"], ["rust-overlay"]);
  assert.deepEqual(snapshotLock.nodes.viberoots.inputs["wasmtime-nixpkgs"], ["wasmtime-nixpkgs"]);
  assert.equal(snapshotLock.nodes["rust-overlay"].locked.rev, "reviewed-overlay");
  assert.equal(snapshotLock.nodes["wasmtime-nixpkgs"].locked.rev, "reviewed-wasmtime");
  assert.equal(snapshotLock.nodes.nixpkgs.locked.rev, "consumer");

  snapshotLock.nodes["wasmtime-nixpkgs"] = { locked: { rev: "stale" } };
  snapshotLock.nodes["rust-overlay"] = { locked: { rev: "stale-overlay" } };
  syncExactViberootsInputs(snapshotLock, sourceLock);
  assert.deepEqual(snapshotLock.nodes.viberoots.inputs["rust-overlay"], ["rust-overlay"]);
  assert.deepEqual(snapshotLock.nodes.viberoots.inputs["wasmtime-nixpkgs"], ["wasmtime-nixpkgs"]);
  assert.equal(snapshotLock.nodes["rust-overlay"].locked.rev, "stale-overlay");
  assert.equal(snapshotLock.nodes["wasmtime-nixpkgs"].locked.rev, "stale");
  assert.equal(snapshotLock.nodes.nixpkgs.locked.rev, "consumer");
});

test("exact source inputs replace stale refs and avoid unrelated node collisions", () => {
  const snapshotLock = {
    nodes: {
      root: { inputs: { "rust-overlay": "old-overlay", viberoots: "viberoots" } },
      viberoots: {
        inputs: {
          "rust-overlay": "old-overlay",
          "wasmtime-nixpkgs": "missing-node",
          nixpkgs: "nixpkgs",
        },
      },
      "old-overlay": { locked: { rev: "stale" } },
      "wasmtime-nixpkgs": { locked: { rev: "consumer-collision" } },
      nixpkgs: { locked: { rev: "consumer" } },
    },
    root: "root",
  };
  const sourceLock = {
    nodes: {
      root: {
        inputs: {
          "rust-overlay": "rust-overlay",
          "wasmtime-nixpkgs": "wasmtime-nixpkgs",
        },
      },
      "rust-overlay": {
        inputs: { nixpkgs: ["nixpkgs"] },
        locked: { rev: "overlay-source" },
      },
      "wasmtime-nixpkgs": { locked: { rev: "wasmtime-source" } },
    },
    root: "root",
  };
  syncExactViberootsInputs(snapshotLock, sourceLock);
  assert.equal(snapshotLock.nodes.viberoots.inputs["rust-overlay"], "rust-overlay");
  assert.equal(snapshotLock.nodes["old-overlay"].locked.rev, "stale");
  assert.deepEqual(snapshotLock.nodes["rust-overlay"], {
    ...sourceLock.nodes["rust-overlay"],
    inputs: { nixpkgs: ["viberoots", "nixpkgs"] },
  });
  assert.equal(snapshotLock.nodes.viberoots.inputs["wasmtime-nixpkgs"], "wasmtime-nixpkgs_2");
  assert.deepEqual(snapshotLock.nodes["wasmtime-nixpkgs_2"], sourceLock.nodes["wasmtime-nixpkgs"]);
  assert.equal(snapshotLock.nodes["wasmtime-nixpkgs"].locked.rev, "consumer-collision");
  assert.equal(snapshotLock.nodes.nixpkgs.locked.rev, "consumer");
});

test("selected snapshots point at one immutable filtered viberoots input", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-selected-input-root-"));
  const snapshot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-selected-input-snapshot-"));
  try {
    const flakeText =
      '{ inputs.viberoots.url = "path:./viberoots-flake-input"; outputs = _: {}; }\n';
    const lockText = `${JSON.stringify({
      nodes: {
        root: { inputs: { viberoots: "viberoots" } },
        viberoots: {
          locked: { path: "./viberoots-flake-input", type: "path" },
          original: { path: "./viberoots-flake-input", type: "path" },
          parent: [],
        },
      },
      root: "root",
      version: 7,
    })}\n`;
    await write(root, "flake.nix", flakeText);
    await write(root, "flake.lock", lockText);
    await write(root, ".viberoots/workspace/flake.nix", flakeText);
    await write(root, ".viberoots/workspace/flake.lock", lockText);
    for (const rel of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "projects/config/node-modules.hashes.json",
      "projects/apps/sample/package.json",
      "projects/apps/sample/pnpm-lock.yaml",
      "viberoots/flake.nix",
      "viberoots/build-tools/tools/dev/zx-init.mjs",
      "viberoots/.viberoots/workspace/buck/graph.json",
      "viberoots/.viberoots/workspace/codex-test-logs/full.log",
      "viberoots/.pnpm-store/v10/index.json",
      "viberoots/node_modules/pkg/index.js",
    ]) {
      await write(root, rel);
    }
    await $({ cwd: root, stdio: "pipe" })`git init -q`;
    await $({ cwd: root, stdio: "pipe" })`git add .`;
    await write(
      root,
      "viberoots/build-tools/untracked-sentinel.ts",
      "export const sentinel = 1;\n",
    );
    assert.match(
      String((await $({ cwd: root, stdio: "pipe" })`git status --short`).stdout),
      /\?\? viberoots\/build-tools\/untracked-sentinel\.ts/,
    );

    const sources: string[] = [];
    for (const source of selectedNodeSnapshotRsyncSources(
      selectedNodeSnapshotRelPaths("projects/apps/sample"),
    )) {
      try {
        await fsp.access(path.join(root, source.replace(/^\.\//, "")));
        sources.push(source);
      } catch {}
    }
    await $({
      cwd: root,
      stdio: "pipe",
    })`rsync -a --delete --relative ${filteredFlakeRsyncExcludeArgs()} ${sources} ${snapshot}/`;

    await fsp.access(path.join(snapshot, "viberoots", "flake.nix"));
    await fsp.access(path.join(snapshot, "viberoots", "build-tools", "untracked-sentinel.ts"));
    for (const rel of [
      "viberoots/.viberoots/workspace/buck",
      "viberoots/.viberoots/workspace/codex-test-logs",
      "viberoots/.pnpm-store",
      "viberoots/node_modules",
    ]) {
      await assert.rejects(fsp.access(path.join(snapshot, rel)), { code: "ENOENT" });
    }

    const flakeDir = path.join(snapshot, ".viberoots", "workspace");
    const storePath = `/nix/store/${"a".repeat(32)}-source`;
    const inputPath = await repairSnapshotViberootsInput(
      { snapDir: snapshot, flakeDir },
      {
        materializeInput: async () => ({
          storePath,
          locked: {
            narHash: "sha256-test",
            path: storePath,
            type: "path",
          },
        }),
      },
    );
    assert.equal(inputPath, storePath);
    await assert.rejects(fsp.access(path.join(flakeDir, "viberoots-flake-input")), {
      code: "ENOENT",
    });
    assert.match(
      await fsp.readFile(path.join(flakeDir, "flake.nix"), "utf8"),
      new RegExp(`viberoots\\.url = "path:${storePath}"`),
    );
    for (const rewrittenDir of [snapshot, flakeDir]) {
      assert.match(
        await fsp.readFile(path.join(rewrittenDir, "flake.nix"), "utf8"),
        new RegExp(`viberoots\\.url = "path:${storePath}"`),
      );
      const lock = JSON.parse(await fsp.readFile(path.join(rewrittenDir, "flake.lock"), "utf8"));
      assert.equal(lock.nodes.viberoots.locked.path, storePath);
      assert.equal(lock.nodes.viberoots.original.path, storePath);
      assert.equal(lock.nodes.viberoots.parent, undefined);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(snapshot, { recursive: true, force: true });
  }
});
