#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import { isLikelyEphemeralIsolation } from "../../dev/verify/buck-orphan-cleanup";
import {
  liveOwnerPidFromEphemeralIsolation,
  ownerPidFromEphemeralIsolation,
  tryTempRepoRootFromBuckDaemonCwd,
} from "../../dev/verify/buck-orphan-cleanup-lib";

test("orphan buck cleanup: matches ephemeral verify/debug/test isolations only", () => {
  const yes = [
    "v-12345-1772235882",
    "verify-nested-12345-deadbeefcafe",
    "verify-nested-deadbeefcafe",
    "zxtest-shared-deadbeef12",
    "debug-cpp-set-final-1772235882",
    "targeted-scaff-1772219350",
    "parity_19426_1772253747273__build_tools_tools_tests_cpp_sanitize_case1",
    "sanitize_19428",
    "importer_strings_19427",
  ];
  const no = [
    "",
    "v2",
    "exporter-shared-1a82e8dd60",
    "devbuild-shared-1a82e8dd60",
    "viberoots",
    "debug-manual-no-timestamp",
  ];
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
