#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { repairSnapshotViberootsInput } from "../../dev/filtered-flake-viberoots-input";
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

test("selected snapshots point at one immutable filtered viberoots input", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-selected-input-root-"));
  const snapshot = await fsp.mkdtemp(path.join(os.tmpdir(), "vbr-selected-input-snapshot-"));
  try {
    await write(
      root,
      ".viberoots/workspace/flake.nix",
      '{ inputs.viberoots.url = "path:./viberoots-flake-input"; outputs = _: {}; }\n',
    );
    await write(
      root,
      ".viberoots/workspace/flake.lock",
      `${JSON.stringify({ nodes: { viberoots: { locked: {}, original: {} } } })}\n`,
    );
    for (const rel of [
      "flake.nix",
      "flake.lock",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "projects/node-modules.hashes.json",
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
    const lock = JSON.parse(await fsp.readFile(path.join(flakeDir, "flake.lock"), "utf8"));
    assert.equal(lock.nodes.viberoots.locked.path, storePath);
    assert.equal(lock.nodes.viberoots.original.path, storePath);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(snapshot, { recursive: true, force: true });
  }
});
