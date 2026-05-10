#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { buck2dProcsForRepo, forkserversUnderRepo } from "./test-helpers/buck-procs";

const repoRoot = "/tmp/viberoots-verify-user.noindex/tmpdir/example-temp-repo-AbCd12";

test("temp repo buck process discovery falls back to pgrep when ps is denied", async () => {
  const calls: string[] = [];
  const deps = {
    psLines: async () => ({ exitCode: 126, lines: [] }),
    pgrepLines: async (pattern: string) => {
      calls.push(pattern);
      if (pattern.includes("buck2d")) {
        return [
          "101 buck2d[example-temp-repo-AbCd12] --isolation-dir zxtest-shared-deadbeef daemon",
          "102 buck2d[other-temp-repo] --isolation-dir zxtest-shared-cafebabe daemon",
        ];
      }
      return [
        `201 (buck2-forkserver) forkserver --state-dir ${repoRoot}/buck-out/zxtest-shared-deadbeef/forkserver`,
        "202 (buck2-forkserver) forkserver --state-dir /tmp/other-temp-repo/buck-out/zxtest-shared-cafebabe/forkserver",
      ];
    },
  };

  const fakeZx = () => {
    throw new Error("ps should be injected by the test");
  };
  const buck2d = await buck2dProcsForRepo(repoRoot, fakeZx, deps);
  const forks = await forkserversUnderRepo(repoRoot, fakeZx, deps);

  assert.deepEqual(
    buck2d.map((p) => ({ pid: p.pid, iso: p.iso })),
    [{ pid: 101, iso: "zxtest-shared-deadbeef" }],
  );
  assert.deepEqual(
    forks.map((p) => ({ pid: p.pid, ppid: p.ppid })),
    [{ pid: 201, ppid: 0 }],
  );
  assert.deepEqual(calls, ["buck2d\\[example-temp-repo-AbCd12\\]", "\\(buck2-forkserver\\)"]);
});
