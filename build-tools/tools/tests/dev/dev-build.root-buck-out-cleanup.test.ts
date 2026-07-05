#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  cleanupDevBuildRootBuckOut,
  duplicateSharedBuckDaemonPidsFromLines,
} from "../../dev/dev-build/root-buck-out-cleanup";

test("dev-build root cleanup preserves shared state for reused builds", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-build-root-cleanup-"));
  try {
    for (const rel of [
      "buck-out/.housekeeping",
      "buck-out/devbuild-shared-deadbeef00",
      "buck-out/exporter-shared-deadbeef00",
      "buck-out/tmp/shared-isolation-locks",
    ]) {
      await fsp.mkdir(path.join(root, rel), { recursive: true });
    }

    const removed = await cleanupDevBuildRootBuckOut(root);

    assert.deepEqual(removed, []);
    for (const rel of [
      "buck-out/.housekeeping",
      "buck-out/devbuild-shared-deadbeef00",
      "buck-out/exporter-shared-deadbeef00",
      "buck-out/tmp/shared-isolation-locks",
    ]) {
      assert.equal((await fsp.stat(path.join(root, rel))).isDirectory(), true, rel);
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("dev-build broad root cleanup removes shared isolation locks", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-build-root-cleanup-"));
  const previous = process.env.VBR_DEVBUILD_BROAD_BUCK_OUT_CLEANUP;
  try {
    await fsp.mkdir(path.join(root, "buck-out/tmp/shared-isolation-locks"), {
      recursive: true,
    });

    process.env.VBR_DEVBUILD_BROAD_BUCK_OUT_CLEANUP = "1";
    const removed = await cleanupDevBuildRootBuckOut(root);

    assert.deepEqual(removed, ["tmp/shared-isolation-locks"]);
    await assert.rejects(fsp.stat(path.join(root, "buck-out/tmp/shared-isolation-locks")));
  } finally {
    if (previous === undefined) {
      delete process.env.VBR_DEVBUILD_BROAD_BUCK_OUT_CLEANUP;
    } else {
      process.env.VBR_DEVBUILD_BROAD_BUCK_OUT_CLEANUP = previous;
    }
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});

test("dev-build duplicate shared cleanup only targets duplicate repo-local daemons", () => {
  const root = "/repo";
  assert.deepEqual(
    duplicateSharedBuckDaemonPidsFromLines(root, [
      "101 1 00:01:00 buck2d[common] --isolation-dir devbuild-shared-deadbeef00 daemon",
      "102 101 00:01:00 (buck2-forkserver) forkserver --state-dir /repo/buck-out/devbuild-shared-deadbeef00/forkserver",
    ]),
    [],
  );
  assert.deepEqual(
    duplicateSharedBuckDaemonPidsFromLines(root, [
      "101 1 00:01:00 buck2d[common] --isolation-dir devbuild-shared-deadbeef00 daemon",
      "102 101 00:01:00 (buck2-forkserver) forkserver --state-dir /repo/buck-out/devbuild-shared-deadbeef00/forkserver",
      "201 1 00:01:00 buck2d[common] --isolation-dir devbuild-shared-deadbeef00 daemon",
      "202 201 00:01:00 (buck2-forkserver) forkserver --state-dir /repo/buck-out/devbuild-shared-deadbeef00/forkserver",
      "301 1 00:01:00 buck2d[common] --isolation-dir devbuild-shared-deadbeef00 daemon",
      "302 301 00:01:00 (buck2-forkserver) forkserver --state-dir /other/buck-out/devbuild-shared-deadbeef00/forkserver",
    ]),
    [101, 102, 201, 202],
  );
});
