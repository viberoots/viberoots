#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeFilteredFlakeRef } from "../../dev/update-pnpm-hash/filtered-flake";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { ensureToolchainPathsForTempRepo } from "../lib/test-helpers/toolchain-paths";

test("update-pnpm-hash uses filtered flake snapshots for every importer build", async () => {
  const helper = await fsp.readFile(
    viberootsSourcePath("viberoots/build-tools/tools/dev/update-pnpm-hash/build-flake.ts"),
    "utf8",
  );
  if (!helper.includes("makeFilteredFlakeRef")) {
    throw new Error("build-flake.ts must create filtered flake snapshots for importer builds");
  }
  if (!helper.includes("step=prepare-filtered-flake")) {
    throw new Error("build-flake.ts must log filtered flake preparation when it is in use");
  }
  if (helper.includes('if (opts.importer === ".")')) {
    throw new Error("build-flake.ts must not bypass filtering for the root importer");
  }
  if (!helper.includes('filtered.flakeRef.endsWith("#pnpm")')) {
    throw new Error(
      "build-flake.ts must validate the filtered pnpm flake contract before stripping #pnpm",
    );
  }
});

async function treeBytes(root: string): Promise<number> {
  let total = 0;
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) total += await treeBytes(candidate);
    else if (entry.isFile()) total += (await fsp.stat(candidate)).size;
  }
  return total;
}

test("root importer filtered snapshot excludes large generated Buck state", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "root-pnpm-filter-"));
  let cleanup: (() => Promise<void>) | undefined;
  try {
    await fsp.mkdir(path.join(root, "build-tools", "tools", "dev"), { recursive: true });
    await fsp.writeFile(path.join(root, "flake.nix"), "{ outputs = _: {}; }\n");
    await fsp.writeFile(path.join(root, "package.json"), '{"name":"viberoots","private":true}\n');
    await fsp.writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await fsp.writeFile(path.join(root, "build-tools", "tools", "dev", "zx-init.mjs"), "\n");
    await fsp.writeFile(path.join(root, "build-tools", "tools", "dev", "viberoots.ts"), "\n");
    await ensureToolchainPathsForTempRepo(root, $);
    const sentinel = path.join(root, ".viberoots", "workspace", "buck", "large-sentinel.bin");
    await fsp.mkdir(path.dirname(sentinel), { recursive: true });
    await fsp.writeFile(sentinel, Buffer.alloc(8 * 1024 * 1024, 0x61));

    const filtered = await makeFilteredFlakeRef({ repoRoot: root, attr: "pnpm", importer: "." });
    cleanup = filtered.cleanup;
    await assert.rejects(
      fsp.access(
        path.join(filtered.workspaceRoot, ".viberoots", "workspace", "buck", "large-sentinel.bin"),
      ),
    );
    assert.ok(
      (await treeBytes(filtered.workspaceRoot)) < 1024 * 1024,
      "root pnpm snapshot must remain bounded when generated Buck state is large",
    );
  } finally {
    await cleanup?.();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
