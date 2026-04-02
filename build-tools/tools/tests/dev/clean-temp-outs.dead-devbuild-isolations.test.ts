#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  pruneDeadDevBuildIsolationDirs,
  shouldRemoveDeadDevBuildIsolationDir,
} from "../../dev/clean-temp-outs-lib.ts";

test("clean-temp-outs removes dead one-shot devbuild isolation dirs", () => {
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("devbuild-12345", () => false),
    true,
  );
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("devbuild-12345-extra", () => false),
    true,
  );
});

test("clean-temp-outs preserves live or shared devbuild isolation dirs", () => {
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("devbuild-12345", () => true),
    false,
  );
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("devbuild-shared-1a82e8dd60", () => false),
    false,
  );
  assert.equal(
    shouldRemoveDeadDevBuildIsolationDir("bucknix-fresh", () => false),
    false,
  );
});

test("clean-temp-outs pruning removes dead one-shot devbuild dirs only", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "clean-temp-outs-"));
  const buckOut = path.join(repoRoot, "buck-out");
  await fsp.mkdir(path.join(buckOut, "devbuild-12345"), { recursive: true });
  await fsp.mkdir(path.join(buckOut, "devbuild-shared-1a82e8dd60"), { recursive: true });
  await fsp.mkdir(path.join(buckOut, "bucknix-fresh"), { recursive: true });

  try {
    const removed = await pruneDeadDevBuildIsolationDirs(repoRoot, () => false);
    assert.deepEqual(removed, ["devbuild-12345"]);
    await assert.doesNotReject(() => fsp.access(path.join(buckOut, "devbuild-shared-1a82e8dd60")));
    await assert.doesNotReject(() => fsp.access(path.join(buckOut, "bucknix-fresh")));
    await assert.rejects(() => fsp.access(path.join(buckOut, "devbuild-12345")));
  } finally {
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});
