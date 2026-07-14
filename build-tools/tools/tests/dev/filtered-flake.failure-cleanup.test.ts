#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeFilteredFlakeRef as makeSelectedFilteredFlakeRef } from "../../dev/filtered-flake";
import { makeFilteredFlakeRef as makeUpdateFilteredFlakeRef } from "../../dev/update-pnpm-hash/filtered-flake";

async function snapshotWorkDirs(
  tmpBase: string,
  baseName: string,
  prefix: string,
): Promise<string[]> {
  const parent =
    process.platform === "darwin" ? path.join(tmpBase, `${baseName}.noindex`) : tmpBase;
  return (await fsp.readdir(parent, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name);
}

test("filtered flake constructors remove owned snapshots when construction fails", async () => {
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), "filtered-failure-cleanup-"));
  const repoRoot = path.join(tmpBase, "empty-repo");
  const priorTmpdir = process.env.TMPDIR;
  await fsp.mkdir(repoRoot);
  process.env.TMPDIR = tmpBase;
  try {
    await assert.rejects(
      makeSelectedFilteredFlakeRef({
        workspaceRoot: repoRoot,
        attr: "missing",
        logPrefix: "[cleanup-test]",
      }),
    );
    assert.deepEqual(await snapshotWorkDirs(tmpBase, "vbr-flake", "vbr-flake-"), []);

    await assert.rejects(makeUpdateFilteredFlakeRef({ repoRoot, attr: "missing" }));
    assert.deepEqual(await snapshotWorkDirs(tmpBase, "scaf-flake", "scaf-flake-"), []);
  } finally {
    if (priorTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = priorTmpdir;
    await fsp.rm(tmpBase, { recursive: true, force: true });
  }
});
