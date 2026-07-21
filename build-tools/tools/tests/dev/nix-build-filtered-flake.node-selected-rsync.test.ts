#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  selectedNodeSnapshotRelPaths,
  selectedNodeSnapshotRsyncSources,
} from "../../dev/nix-build-filtered-flake-lib";

test("selected node snapshot rsync sources materialize importer package files", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "node-selected-snapshot-root-"));
  const out = await fsp.mkdtemp(path.join(os.tmpdir(), "node-selected-snapshot-out-"));
  try {
    for (const rel of [
      "flake.nix",
      "flake.lock",
      ".npmrc",
      "gomod2nix.toml",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "projects/config/node-modules.hashes.json",
      ".viberoots/workspace/flake.nix",
      "build-tools/tools/dev",
      "third_party/providers",
      "toolchains",
      "types",
      "viberoots/flake.nix",
      "projects/apps/sample-app/package.json",
      "projects/apps/sample-app/pnpm-lock.yaml",
      "projects/apps/sample-app-native/package.json",
      "projects/libs/sample-app-go/package.json",
      "projects/libs/shared-wasm-inline/package.json",
      "projects/apps/unrelated/package.json",
    ]) {
      const abs = path.join(root, rel);
      const isFile = path.extname(rel) !== "" || path.basename(rel).startsWith(".");
      await fsp.mkdir(isFile ? path.dirname(abs) : abs, { recursive: true });
      if (isFile) await fsp.writeFile(abs, `${rel}\n`, "utf8");
    }

    const sources = selectedNodeSnapshotRsyncSources(
      selectedNodeSnapshotRelPaths("projects/apps/sample-app", [
        "projects/libs/shared-wasm-inline",
      ]),
    );
    await $({ cwd: root, stdio: "pipe" })`rsync -a --delete --relative ${sources} ${out}/`;

    assert.equal(
      await fsp.readFile(path.join(out, "projects/apps/sample-app/package.json"), "utf8"),
      "projects/apps/sample-app/package.json\n",
    );
    assert.equal(
      await fsp.readFile(path.join(out, "projects/apps/sample-app/pnpm-lock.yaml"), "utf8"),
      "projects/apps/sample-app/pnpm-lock.yaml\n",
    );
    await fsp.access(path.join(out, "projects/apps/sample-app-native/package.json"));
    await fsp.access(path.join(out, "projects/libs/sample-app-go/package.json"));
    await fsp.access(path.join(out, "pnpm-workspace.yaml"));
    await fsp.access(path.join(out, "projects/libs/shared-wasm-inline/package.json"));
    await assert.rejects(fsp.access(path.join(out, "projects/apps/unrelated/package.json")));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(out, { recursive: true, force: true });
  }
});
