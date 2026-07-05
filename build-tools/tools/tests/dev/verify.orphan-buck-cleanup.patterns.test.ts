#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import process from "node:process";
import { test } from "node:test";
import { isLikelyEphemeralIsolation } from "../../dev/verify/buck-orphan-cleanup";
import { duplicateManagedBuckPidsForTest } from "../../dev/verify/final-orphan-cleanup";
import {
  liveOwnerPidFromEphemeralIsolation,
  ownerPidFromEphemeralIsolation,
  tryTempRepoRootFromBuckDaemonCwd,
} from "../../dev/verify/buck-orphan-cleanup-lib";
import { buckIsolationProcessPidsFromLines } from "../../dev/verify/process-control";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("orphan buck cleanup: matches ephemeral verify/debug/test isolations only", () => {
  const yes = [
    "v-12345-1772235882",
    "verify-nested-12345-deadbeefcafe",
    "verify-nested-deadbeefcafe",
    "zxtest-shared-deadbeef12",
    "exporter-shared-1a82e8dd60",
    "debug-cpp-set-final-1772235882",
    "targeted-scaff-1772219350",
    "parity_19426_1772253747273__build_tools_tools_tests_cpp_sanitize_case1",
    "sanitize_19428",
    "importer_strings_19427",
  ];
  const no = ["", "v2", "devbuild-shared-1a82e8dd60", "viberoots", "debug-manual-no-timestamp"];
  for (const iso of yes) assert.equal(isLikelyEphemeralIsolation(iso), true, iso);
  for (const iso of no) assert.equal(isLikelyEphemeralIsolation(iso), false, iso);
});

test("orphan buck cleanup: live verify owner isolations are protected", () => {
  const current = `v-${process.pid}-1772235882`;
  const currentNested = `verify-nested-${process.pid}-deadbeefcafe`;
  assert.equal(ownerPidFromEphemeralIsolation(current), process.pid);
  assert.equal(ownerPidFromEphemeralIsolation(currentNested), process.pid);
  assert.equal(liveOwnerPidFromEphemeralIsolation(current), process.pid);
  assert.equal(liveOwnerPidFromEphemeralIsolation(currentNested), process.pid);
  assert.equal(liveOwnerPidFromEphemeralIsolation("v-999999999-1772235882"), null);
  assert.equal(liveOwnerPidFromEphemeralIsolation("verify-nested-deadbeefcafe"), null);
});

test("orphan buck cleanup: live-owner parsing stays scoped to the encoded verify pid", () => {
  const currentNested = `verify-nested-${process.pid}-deadbeefcafe`;
  const otherNested = `verify-nested-${process.pid + 1}-deadbeefcafe`;
  assert.equal(liveOwnerPidFromEphemeralIsolation(currentNested), process.pid);
  assert.equal(ownerPidFromEphemeralIsolation(otherNested), process.pid + 1);
});

test("orphan buck cleanup: orphaned temp-repo daemons are killable with live temp roots", async () => {
  const source = await readRepoFile("build-tools/tools/dev/verify/buck-orphan-cleanup.ts");

  assert.match(source, /forkserversByParentPid/);
  assert.match(source, /childTempForkservers/);
  assert.match(source, /isTempRepoRoot\(fork\.repoRoot\)/);
  assert.match(source, /killed temp-repo daemon/);
  assert.doesNotMatch(source, /if \(await pathExists\(mapped\.repoRoot\)\) continue;/);
});

test("orphan buck cleanup: missing temp-root daemons require cwd root evidence", () => {
  assert.deepEqual(
    tryTempRepoRootFromBuckDaemonCwd(
      "/private/tmp/viberoots-verify-user.noindex/tmpdir/viberoots-buck-cell-A1b2C3/buck-out/v2",
    ),
    {
      repoRoot: "/private/tmp/viberoots-verify-user.noindex/tmpdir/viberoots-buck-cell-A1b2C3",
      iso: "v2",
    },
  );
  assert.deepEqual(
    tryTempRepoRootFromBuckDaemonCwd(
      "/private/tmp/viberoots-verify-user.noindex/tmpdir/kubernetes-e2e-smoke-failure-Mybe1Z/buck-out/zxtest-install-sync-980d024fc5",
    ),
    {
      repoRoot:
        "/private/tmp/viberoots-verify-user.noindex/tmpdir/kubernetes-e2e-smoke-failure-Mybe1Z",
      iso: "zxtest-install-sync-980d024fc5",
    },
  );
  assert.equal(tryTempRepoRootFromBuckDaemonCwd("/Users/example/repo/buck-out/v2"), null);
  assert.equal(
    tryTempRepoRootFromBuckDaemonCwd(
      "/private/tmp/viberoots-verify-user.noindex/tmpdir-suffix/repo/buck-out/v2",
    ),
    null,
  );
});

test("process-control buck isolation fallback is scoped by repo-root forkserver state", () => {
  assert.deepEqual(
    buckIsolationProcessPidsFromLines({
      root: "/repo",
      iso: "v-explain-selection",
      lines: [
        "101 1 00:01:00 buck2d[common] --isolation-dir v-explain-selection daemon",
        "102 101 00:01:00 (buck2-forkserver) forkserver --state-dir /repo/buck-out/v-explain-selection/forkserver",
        "201 1 00:01:00 buck2d[common] --isolation-dir v-explain-selection daemon",
        "202 201 00:01:00 (buck2-forkserver) forkserver --state-dir /other/buck-out/v-explain-selection/forkserver",
      ],
    }),
    [101, 102],
  );
});

test("final orphan cleanup prunes older duplicate repo-local v2 daemons only", () => {
  assert.deepEqual(
    duplicateManagedBuckPidsForTest("/repo", [
      "101 1 00:01:00 buck2d[common] --isolation-dir v2 daemon",
      "102 101 00:01:00 (buck2-forkserver) forkserver --state-dir /repo/buck-out/v2/forkserver",
      "201 1 10:00:00 buck2d[common] --isolation-dir v2 daemon",
      "202 201 10:00:00 (buck2-forkserver) forkserver --state-dir /repo/buck-out/v2/forkserver",
      "301 1 12:00:00 buck2d[common] --isolation-dir v2 daemon",
      "302 301 12:00:00 (buck2-forkserver) forkserver --state-dir /other/buck-out/v2/forkserver",
    ]),
    [201, 202],
  );
});
