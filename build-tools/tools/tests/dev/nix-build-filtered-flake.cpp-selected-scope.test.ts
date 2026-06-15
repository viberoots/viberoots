#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  computeSelectedCppPackageClosure,
  graphNodesFromJson,
  selectedCppSnapshotRelPaths,
  selectedCppSnapshotRsyncSources,
} from "../../dev/nix-build-filtered-flake-lib";

test("selected cpp filtered-flake snapshots follow the target package closure", () => {
  const graph = [
    {
      name: "root//projects/apps/demo:demo (config//platforms:default#hash)",
      deps: [
        "//projects/libs/core:core",
        "root//projects/libs/math:headers (config//platforms:default#hash)",
        "//third_party/providers:nix_pkgs_zlib",
      ],
    },
    {
      name: "//projects/libs/core:core",
      deps: ["//projects/libs/math:headers"],
    },
    {
      name: "//projects/libs/math:headers",
      deps: [],
    },
    {
      name: "//third_party/providers:nix_pkgs_zlib",
      deps: [],
    },
  ];

  const packagePaths = computeSelectedCppPackageClosure(
    graphNodesFromJson(graph),
    "//projects/apps/demo:demo",
  );
  assert.deepEqual(packagePaths, [
    "projects/apps/demo",
    "projects/libs/core",
    "projects/libs/math",
    "third_party/providers",
  ]);

  const snapshotRelPaths = selectedCppSnapshotRelPaths(packagePaths);
  assert.deepEqual(snapshotRelPaths.slice(0, 6), [
    ".npmrc",
    "flake.lock",
    "flake.nix",
    "gomod2nix.toml",
    "package.json",
    "pnpm-lock.yaml",
  ]);
  assert.ok(
    snapshotRelPaths.includes("build-tools") &&
      snapshotRelPaths.includes("prelude") &&
      snapshotRelPaths.includes("toolchains") &&
      snapshotRelPaths.includes("viberoots"),
    "expected selected cpp snapshot to retain shared flake and local viberoots roots",
  );
  assert.ok(
    snapshotRelPaths.includes("projects/apps/demo") &&
      snapshotRelPaths.includes("projects/libs/core") &&
      snapshotRelPaths.includes("projects/libs/math"),
    "expected selected cpp snapshot to retain target package closure paths",
  );
  assert.ok(
    !snapshotRelPaths.includes("projects/apps/unrelated"),
    "selected cpp snapshot should not carry unrelated project packages",
  );

  assert.deepEqual(selectedCppSnapshotRsyncSources(snapshotRelPaths).slice(0, 3), [
    "./.npmrc",
    "./flake.lock",
    "./flake.nix",
  ]);
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
      "build-tools/tools/dev",
      "prelude",
      "third_party/providers",
      "toolchains",
      "types",
      "viberoots/flake.nix",
      "projects/libs/pleomino-solver-wasm",
    ]) {
      const abs = path.join(root, rel);
      const isFile = path.extname(rel) !== "" || path.basename(rel).startsWith(".");
      await fsp.mkdir(isFile ? path.dirname(abs) : abs, { recursive: true });
      if (isFile) {
        await fsp.writeFile(abs, `${rel}\n`, "utf8");
      }
    }

    const sources = selectedCppSnapshotRsyncSources([
      "flake.nix",
      "flake.lock",
      ".npmrc",
      "package.json",
      "pnpm-lock.yaml",
      "build-tools",
      "prelude",
      "third_party",
      "toolchains",
      "viberoots",
      "projects/libs/pleomino-solver-wasm",
    ]);
    await $({ cwd: root, stdio: "pipe" })`rsync -a --delete --relative ${sources} ${out}/`;

    assert.equal(await fsp.readFile(path.join(out, "flake.nix"), "utf8"), "flake.nix\n");
    assert.equal(await fsp.readFile(path.join(out, "flake.lock"), "utf8"), "flake.lock\n");
    await fsp.access(path.join(out, "projects", "libs", "pleomino-solver-wasm"));
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
