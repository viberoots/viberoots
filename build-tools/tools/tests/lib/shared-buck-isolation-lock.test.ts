#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  isSharedBuckIsolation,
  withSharedBuckIsolationStartupLock,
} from "../../lib/shared-buck-isolation-lock";

test("shared Buck isolation lock only treats reviewed shared isolations as shared", () => {
  assert.equal(isSharedBuckIsolation("exporter-shared-1a82e8dd60"), true);
  assert.equal(isSharedBuckIsolation("devbuild-shared-1a82e8dd60"), true);
  assert.equal(isSharedBuckIsolation("verify-nested-123-deadbeefcafe"), false);
  assert.equal(isSharedBuckIsolation("exporter-123"), false);
  assert.equal(isSharedBuckIsolation("devbuild-123"), false);
});

test("shared Buck isolation lock serializes first shared startup per process", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "shared-buck-lock-"));
  let active = 0;
  let maxActive = 0;
  try {
    await Promise.all([
      withSharedBuckIsolationStartupLock(root, "exporter-shared-test", async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 100));
        active--;
      }),
      withSharedBuckIsolationStartupLock(root, "exporter-shared-test", async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        active--;
      }),
    ]);
    assert.equal(maxActive, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }
});
