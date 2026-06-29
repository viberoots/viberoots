#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { createIsolation } from "../../dev/dev-build/isolation";

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
    assert.equal(iso.registerForCleanup, false);
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

test("dev-build cleanup preserves reusable Buck daemons by default", async () => {
  const isolationSource = await fsp.readFile(
    "viberoots/build-tools/tools/dev/dev-build/isolation.ts",
    "utf8",
  );
  const cleanupSource = await fsp.readFile(
    "viberoots/build-tools/tools/dev/dev-build/root-buck-out-cleanup.ts",
    "utf8",
  );
  const runSource = await fsp.readFile(
    "viberoots/build-tools/tools/dev/dev-build/run-dev-build.ts",
    "utf8",
  );

  assert.match(isolationSource, /if \(!createdOwnIsolation \|\| !killOnExit\) return;/);
  assert.match(isolationSource, /const registerForCleanup = createdOwnIsolation && killOnExit;/);
  assert.match(isolationSource, /registerForCleanup,/);
  assert.match(runSource, /stateFile && iso\.buckIsolation && iso\.registerForCleanup/);
  assert.match(cleanupSource, /VBR_DEVBUILD_BROAD_BUCK_OUT_CLEANUP/);
  assert.match(cleanupSource, /if \(live\.has\(entry\) && !broadCleanup\) continue;/);
});

test("dev-build isolation override can force a fresh daemon for one run", () => {
  const prevReuse = process.env.BUCK_DEVBUILD_REUSE_DAEMON;
  const prevKill = process.env.BUCK_DEVBUILD_KILL_ON_EXIT;
  const prevIso = process.env.BUCK_ISOLATION_DIR;
  const prevNoIso = process.env.BUCK_NO_ISOLATION;
  delete process.env.BUCK_DEVBUILD_REUSE_DAEMON;
  delete process.env.BUCK_DEVBUILD_KILL_ON_EXIT;
  delete process.env.BUCK_ISOLATION_DIR;
  delete process.env.BUCK_NO_ISOLATION;

  try {
    const iso = createIsolation({ reuseDaemon: false });
    assert.equal(iso.reuseDaemon, false);
    assert.equal(iso.killOnExit, true);
    assert.equal(iso.registerForCleanup, true);
    assert.ok(iso.buckIsolation.startsWith("devbuild-"));
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
