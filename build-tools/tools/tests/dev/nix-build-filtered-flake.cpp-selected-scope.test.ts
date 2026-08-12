#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  FILTERED_FLAKE_RSYNC_EXCLUDES,
  selectedCppSnapshotRsyncSources,
  selectedNodeSnapshotRelPaths,
  selectedNodeSnapshotRsyncSources,
} from "../../dev/nix-build-filtered-flake-lib";
import { directorySnapshot } from "./directory-snapshot";
import { assertSelectedCppSnapshotContract } from "./nix-build-filtered-flake.cpp-selected-contract";
test("selected cpp filtered-flake snapshots follow the target package closure", () => {
  assertSelectedCppSnapshotContract();
});

test("selected cpp snapshot rsync sources keep flake files at the snapshot root", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "cpp-selected-snapshot-root-"));
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), "cpp-selected-snapshot-out-"));
  try {
    for (const rel of [
      "flake.nix",
      "flake.lock",
      ".npmrc",
      "gomod2nix.toml",
      "package.json",
      "pnpm-lock.yaml",
      ".viberoots/buck/graph.json",
      "build-tools/tools/dev",
      "build-tools/tools/nix/nixpkgs-source-registry.nix",
      "build-tools/tools/nix/planner/source-selection.nix",
      "prelude",
      "third_party/providers",
      "toolchains",
      "types",
      "viberoots/flake.nix",
      "projects/libs/sample-solver-wasm",
    ]) {
      const abs = path.join(root, rel);
      const isFile = path.extname(rel) !== "" || path.basename(rel).startsWith(".");
      await fsp.mkdir(isFile ? path.dirname(abs) : abs, { recursive: true });
      if (isFile) {
        await fsp.writeFile(abs, `${rel}\n`, "utf8");
      }
    }
    await fsp.mkdir(path.join(root, ".viberoots", "workspace"), { recursive: true });
    await fsp.symlink("../buck", path.join(root, ".viberoots", "workspace", "buck"));

    const sources = selectedCppSnapshotRsyncSources([
      "flake.nix",
      "flake.lock",
      ".npmrc",
      "package.json",
      "pnpm-lock.yaml",
      ".viberoots",
      "build-tools",
      "prelude",
      "third_party",
      "toolchains",
      "viberoots",
      "projects/libs/sample-solver-wasm",
    ]);
    await $({ cwd: root, stdio: "pipe" })`rsync -a --delete --relative ${sources} ${out}/`;

    assert.equal(await fsp.readFile(path.join(out, "flake.nix"), "utf8"), "flake.nix\n");
    assert.equal(await fsp.readFile(path.join(out, "flake.lock"), "utf8"), "flake.lock\n");
    await fsp.access(path.join(out, "projects", "libs", "sample-solver-wasm"));
    assert.equal(
      await fsp.readFile(path.join(out, ".viberoots", "buck", "graph.json"), "utf8"),
      ".viberoots/buck/graph.json\n",
    );
    assert.equal(await fsp.readlink(path.join(out, ".viberoots", "workspace", "buck")), "../buck");
    await fsp.access(path.join(out, "build-tools"));
    assert.equal(
      await fsp.readFile(path.join(out, "viberoots", "flake.nix"), "utf8"),
      "viberoots/flake.nix\n",
    );
    await assert.rejects(fsp.access(path.join(out, "Users")));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(out, { recursive: true, force: true });
  }
});

test("selected node filtered-flake snapshots keep only the importer and native sidecars", () => {
  const snapshotRelPaths = selectedNodeSnapshotRelPaths("projects/apps/sample-app", [
    "projects/libs/shared-ui",
  ]);

  assert.deepEqual(snapshotRelPaths.slice(0, 8), [
    ".npmrc",
    "flake.lock",
    "flake.nix",
    "gomod2nix.toml",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "projects/config/node-modules.hashes.json",
  ]);
  assert.ok(
    snapshotRelPaths.includes("build-tools") &&
      snapshotRelPaths.includes("toolchains") &&
      snapshotRelPaths.includes("viberoots"),
    "expected selected node snapshot to retain shared flake and local viberoots roots",
  );
  assert.ok(
    !snapshotRelPaths.includes("prelude"),
    "generated root prelude must not enter filtered Nix source snapshots",
  );
  assert.ok(
    snapshotRelPaths.includes("projects/apps/sample-app") &&
      snapshotRelPaths.includes("projects/libs/shared-ui") &&
      snapshotRelPaths.includes("projects/apps/sample-app-native") &&
      snapshotRelPaths.includes("projects/libs/sample-app-go"),
    "expected selected node snapshot to retain importer, workspace deps, and native sidecars",
  );
  assert.ok(
    !snapshotRelPaths.includes("projects/apps/unrelated"),
    "selected node snapshot should not carry unrelated project packages",
  );

  assert.deepEqual(selectedNodeSnapshotRsyncSources(snapshotRelPaths).slice(0, 3), [
    "./.npmrc",
    "./flake.lock",
    "./flake.nix",
  ]);
});

test("filtered-flake rsync excludes generated workspace state that churns source hashes", () => {
  for (const rel of [
    ".codex-logs",
    "/.nix-gcroots",
    "/.nix-zsh",
    "/test-tmp-paths.log",
    ".viberoots/buck",
    ".viberoots/cache",
    ".viberoots/codex-logs",
    ".viberoots/workspace/buck",
    ".viberoots/workspace/cache",
    ".viberoots/workspace/cargo-home",
    ".viberoots/workspace/codex-test-logs",
    ".viberoots/workspace/install-cache",
    ".viberoots/workspace/nix-xdg-cache",
    ".viberoots/workspace/pr-logs",
    ".viberoots/workspace/xdg-cache",
    "viberoots/.codex-logs",
    "viberoots/.direnv",
    "viberoots/.DS_Store",
    "viberoots/.nix-gcroots",
    "viberoots/.nix-zsh",
    "viberoots/.viberoots",
    "viberoots/buck-out",
    "viberoots/build-tools/tmp",
    "viberoots/test-logs",
    "viberoots/test-tmp-paths.log",
  ]) {
    assert.ok(
      FILTERED_FLAKE_RSYNC_EXCLUDES.includes(rel),
      `missing filtered-flake exclude: ${rel}`,
    );
  }
});

test("filtered snapshots stay stable when Cargo mutates its generated cache", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "filtered-cargo-cache-root-"));
  const first = await fsp.mkdtemp(path.join(os.tmpdir(), "filtered-cargo-cache-first-"));
  const second = await fsp.mkdtemp(path.join(os.tmpdir(), "filtered-cargo-cache-second-"));
  const changed = await fsp.mkdtemp(path.join(os.tmpdir(), "filtered-cargo-cache-changed-"));
  try {
    const cargoCache = path.join(root, ".viberoots/workspace/cargo-home/.global-cache");
    const cargoRegistry = path.join(root, ".viberoots/workspace/cargo-home/registry/cache.bin");
    const flake = path.join(root, ".viberoots/workspace/flake.nix");
    const project = path.join(root, "projects/apps/demo/source.txt");
    for (const file of [cargoCache, cargoRegistry, flake, project]) {
      await fsp.mkdir(path.dirname(file), { recursive: true });
    }
    await fsp.writeFile(cargoCache, "before\n");
    await fsp.writeFile(cargoRegistry, "before\n");
    await fsp.writeFile(flake, "{}\n");
    await fsp.writeFile(project, "stable\n");
    const sources = ["./.viberoots", "./projects"];
    const excludes = FILTERED_FLAKE_RSYNC_EXCLUDES.flatMap((value) => ["--exclude", value]);
    await $({ cwd: root })`rsync -a --relative ${excludes} ${sources} ${first}/`;
    await fsp.writeFile(cargoCache, "after\n");
    await fsp.writeFile(cargoRegistry, "after\n");
    await $({ cwd: root })`rsync -a --relative ${excludes} ${sources} ${second}/`;
    await assert.rejects(fsp.access(path.join(first, ".viberoots/workspace/cargo-home")));
    assert.equal(
      await fsp.readFile(path.join(second, project.slice(root.length + 1)), "utf8"),
      "stable\n",
    );
    assert.deepEqual(await directorySnapshot(first), await directorySnapshot(second));
    await fsp.writeFile(project, "declared change\n");
    await $({ cwd: root })`rsync -a --relative ${excludes} ${sources} ${changed}/`;
    assert.notDeepEqual(await directorySnapshot(second), await directorySnapshot(changed));
  } finally {
    await Promise.all(
      [root, first, second, changed].map((value) =>
        fsp.rm(value, { recursive: true, force: true }),
      ),
    );
  }
});
