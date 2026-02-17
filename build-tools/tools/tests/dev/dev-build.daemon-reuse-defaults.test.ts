#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createIsolation } from "../../dev/dev-build/isolation.ts";

test("dev-build reuses buck daemon by default", () => {
  const prevReuse = process.env.BUCK_DEVBUILD_REUSE_DAEMON;
  const prevKill = process.env.BUCK_DEVBUILD_KILL_ON_EXIT;
  const prevIso = process.env.BUCK_ISOLATION_DIR;
  const prevNoIso = process.env.BUCK_NO_ISOLATION;
  delete process.env.BUCK_DEVBUILD_REUSE_DAEMON;
  delete process.env.BUCK_DEVBUILD_KILL_ON_EXIT;
  delete process.env.BUCK_ISOLATION_DIR;
  delete process.env.BUCK_NO_ISOLATION;

  try {
    const iso = createIsolation();
    assert.equal(iso.reuseDaemon, true);
    assert.equal(iso.killOnExit, false);
    assert.ok(iso.buckIsolation.startsWith("devbuild-shared-"));
    assert.deepEqual(iso.isolationFlags, ["--isolation-dir", iso.buckIsolation]);
  } finally {
    if (prevReuse === undefined) delete process.env.BUCK_DEVBUILD_REUSE_DAEMON;
    else process.env.BUCK_DEVBUILD_REUSE_DAEMON = prevReuse;
    if (prevKill === undefined) delete process.env.BUCK_DEVBUILD_KILL_ON_EXIT;
    else process.env.BUCK_DEVBUILD_KILL_ON_EXIT = prevKill;
    if (prevIso === undefined) delete process.env.BUCK_ISOLATION_DIR;
    else process.env.BUCK_ISOLATION_DIR = prevIso;
    if (prevNoIso === undefined) delete process.env.BUCK_NO_ISOLATION;
    else process.env.BUCK_NO_ISOLATION = prevNoIso;
  }
});
