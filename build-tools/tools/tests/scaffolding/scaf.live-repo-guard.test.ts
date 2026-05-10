#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  liveRepoScaffoldGuardMessage,
  shouldRefuseLiveRepoScaffold,
} from "../../scaffolding/scaf/live-repo-guard";

const REPO_ROOT = process.cwd();

test("scaf live-repo guard allows temp workspaces during managed test runs", () => {
  const tmp = path.join(REPO_ROOT, "buck-out", "tmp", "guard-probe");
  assert.equal(
    shouldRefuseLiveRepoScaffold({
      cwd: tmp,
      repoRoot: REPO_ROOT,
      env: {
        ...process.env,
        REPO_ROOT,
        WORKSPACE_ROOT: tmp,
        VERIFY_TIMEOUT_SECS: "1",
      },
    }),
    false,
  );
});

test("scaf live-repo guard refuses live repo when managed test env loses temp workspace", () => {
  assert.equal(
    shouldRefuseLiveRepoScaffold({
      cwd: REPO_ROOT,
      repoRoot: REPO_ROOT,
      env: {
        ...process.env,
        REPO_ROOT,
        VERIFY_TIMEOUT_SECS: "1",
      },
    }),
    true,
  );
});

test("scaf live-repo guard keeps normal developer scaffolds allowed", () => {
  assert.equal(
    shouldRefuseLiveRepoScaffold({
      cwd: REPO_ROOT,
      repoRoot: REPO_ROOT,
      env: {
        ...process.env,
        REPO_ROOT: "",
        WORKSPACE_ROOT: "",
        VERIFY_TIMEOUT_SECS: "",
        TEST_NIX_TIMEOUT_SECS: "",
        BUCK_TEST_SRC: "",
        BUCK_TEST_TARGET: "",
        BUCK_TARGET: "",
        VBR_VERIFY_LOCK_DIR: "",
        VBR_VERIFY_LOG_FILE: "",
      },
    }),
    false,
  );
});

test("scaf live-repo guard exposes a clear operator message", () => {
  assert.match(liveRepoScaffoldGuardMessage(), /WORKSPACE_ROOT points to a temp workspace/);
  assert.match(liveRepoScaffoldGuardMessage(), /SCAF_ALLOW_LIVE_REPO=1/);
});
