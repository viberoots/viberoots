#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  pruneDeadDevBuildIsolationDirs,
  pruneDeadOwnedBuckIsolationDirs,
  shouldRemoveDeadDevBuildIsolationDir,
  shouldRemoveDeadOwnedBuckIsolationDir,
} from "../../dev/clean-temp-outs-lib";

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

test("clean-temp-outs removes dead owned verify isolation dirs", () => {
  assert.equal(
    shouldRemoveDeadOwnedBuckIsolationDir("v-12345-1776831730728", () => false),
    true,
  );
  assert.equal(
    shouldRemoveDeadOwnedBuckIsolationDir("verify-nested-12345-deadbeefcafe", () => false),
    true,
  );
  assert.equal(
    shouldRemoveDeadOwnedBuckIsolationDir("exporter-12345-deadbeefcafe", () => false),
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
    shouldRemoveDeadDevBuildIsolationDir("workspace-fresh", () => false),
    false,
  );
  assert.equal(
    shouldRemoveDeadOwnedBuckIsolationDir("v-12345-1776831730728", () => true),
    false,
  );
  assert.equal(
    shouldRemoveDeadOwnedBuckIsolationDir("exporter-shared-1a82e8dd60", () => false),
    false,
  );
});

test("clean-temp-outs pruning removes dead one-shot devbuild dirs only", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "clean-temp-outs-"));
  const buckOut = path.join(repoRoot, "buck-out");
  await fsp.mkdir(path.join(buckOut, "devbuild-12345"), { recursive: true });
  await fsp.mkdir(path.join(buckOut, "devbuild-shared-1a82e8dd60"), { recursive: true });
  await fsp.mkdir(path.join(buckOut, "workspace-fresh"), { recursive: true });

  try {
    const removed = await pruneDeadDevBuildIsolationDirs(repoRoot, () => false);
    assert.deepEqual(removed, ["devbuild-12345"]);
    await assert.doesNotReject(() => fsp.access(path.join(buckOut, "devbuild-shared-1a82e8dd60")));
    await assert.doesNotReject(() => fsp.access(path.join(buckOut, "workspace-fresh")));
    await assert.rejects(() => fsp.access(path.join(buckOut, "devbuild-12345")));
  } finally {
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});

test("clean-temp-outs pruning removes dead owned dirs and preserves live/shared dirs", async () => {
  const repoRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "clean-temp-outs-owned-"));
  const buckOut = path.join(repoRoot, "buck-out");
  await fsp.mkdir(path.join(buckOut, "v-12345-1776831730728"), { recursive: true });
  await fsp.mkdir(path.join(buckOut, "verify-nested-23456-deadbeefcafe"), { recursive: true });
  await fsp.mkdir(path.join(buckOut, "v-99999-1776831730728"), { recursive: true });
  await fsp.mkdir(path.join(buckOut, "exporter-shared-1a82e8dd60"), { recursive: true });

  try {
    const removed = await pruneDeadOwnedBuckIsolationDirs(
      repoRoot,
      (pid) => pid === 99999,
      new Set(["verify-nested-23456-deadbeefcafe"]),
    );
    assert.deepEqual(removed.sort(), ["v-12345-1776831730728"]);
    await assert.doesNotReject(() => fsp.access(path.join(buckOut, "v-99999-1776831730728")));
    await assert.doesNotReject(() =>
      fsp.access(path.join(buckOut, "verify-nested-23456-deadbeefcafe")),
    );
    await assert.doesNotReject(() => fsp.access(path.join(buckOut, "exporter-shared-1a82e8dd60")));
    await assert.rejects(() => fsp.access(path.join(buckOut, "v-12345-1776831730728")));
  } finally {
    await fsp.rm(repoRoot, { recursive: true, force: true });
  }
});
