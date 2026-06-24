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
    cwdForPid: async (pid: number) => {
      if (pid === 101) return `${repoRoot}/buck-out/zxtest-shared-deadbeef`;
      return "/tmp/other-temp-repo/buck-out/zxtest-shared-cafebabe";
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

test("temp repo buck process discovery includes nested consumer daemons by cwd", async () => {
  const cwdPids: number[] = [];
  const deps = {
    psLines: async () => ({
      exitCode: 0,
      lines: [
        "101 buck2d[example-temp-repo-AbCd12] --isolation-dir v2 daemon",
        "102 buck2d[consumer-a] --isolation-dir v2 daemon",
        "103 buck2d[consumer-b] --isolation-dir v2 daemon",
        "104 buck2d[other-consumer] --isolation-dir v2 daemon",
        `202 102 (buck2-forkserver) forkserver --state-dir ${repoRoot}/consumer-a/buck-out/v2/forkserver`,
        `203 103 (buck2-forkserver) forkserver --state-dir /private${repoRoot}/consumer-b/buck-out/v2/forkserver`,
      ],
    }),
    cwdForPid: async (pid: number) => {
      cwdPids.push(pid);
      if (pid === 101) return `${repoRoot}/buck-out/v2`;
      if (pid === 102) return `${repoRoot}/consumer-a/buck-out/v2`;
      if (pid === 103) return `/private${repoRoot}/consumer-b/buck-out/v2`;
      return "/tmp/other-temp-repo/buck-out/v2";
    },
  };

  const fakeZx = () => {
    throw new Error("lsof should be injected by the test");
  };
  const buck2d = await buck2dProcsForRepo(repoRoot, fakeZx, deps);

  assert.deepEqual(
    buck2d.map((p) => ({ pid: p.pid, iso: p.iso })),
    [
      { pid: 101, iso: "v2" },
      { pid: 102, iso: "v2" },
      { pid: 103, iso: "v2" },
    ],
  );
  assert.deepEqual(cwdPids, [101, 102, 103]);
});

test("temp repo buck process discovery rejects daemon-name-only ownership", async () => {
  const deps = {
    psLines: async () => ({
      exitCode: 0,
      lines: ["101 buck2d[example-temp-repo-AbCd12] --isolation-dir v2 daemon"],
    }),
    cwdForPid: async () => "",
  };

  const fakeZx = () => {
    throw new Error("process discovery should be injected by the test");
  };

  assert.deepEqual(await buck2dProcsForRepo(repoRoot, fakeZx, deps), []);
});

test("temp repo buck process discovery avoids cwd probes for unrelated daemons", async () => {
  const cwdPids: number[] = [];
  const unrelated = Array.from(
    { length: 100 },
    (_, i) => `${500 + i} buck2d[unrelated-${i}] --isolation-dir v2 daemon`,
  );
  const deps = {
    psLines: async () => ({
      exitCode: 0,
      lines: [
        "101 buck2d[example-temp-repo-AbCd12] --isolation-dir v2 daemon",
        "102 buck2d[consumer-a] --isolation-dir v2 daemon",
        ...unrelated,
        `202 102 (buck2-forkserver) forkserver --state-dir ${repoRoot}/consumer-a/buck-out/v2/forkserver`,
      ],
    }),
    cwdForPid: async (pid: number) => {
      cwdPids.push(pid);
      if (pid === 101) return `${repoRoot}/buck-out/v2`;
      if (pid === 102) return `${repoRoot}/consumer-a/buck-out/v2`;
      return "/tmp/other-temp-repo/buck-out/v2";
    },
  };

  const fakeZx = () => {
    throw new Error("process discovery should be injected by the test");
  };

  assert.deepEqual(
    (await buck2dProcsForRepo(repoRoot, fakeZx, deps)).map((p) => p.pid),
    [101, 102],
  );
  assert.deepEqual(cwdPids, [101, 102]);
});

test("temp repo buck process discovery keeps concurrent nested consumer roots separate", async () => {
  const rootA = "/tmp/viberoots-verify-user.noindex/tmpdir/outer-a-AbCd12";
  const rootB = "/tmp/viberoots-verify-user.noindex/tmpdir/outer-b-EfGh34";
  const forkState = (root: string, consumer: string, iso: string) =>
    `${root}/${consumer}/buck-out/${iso}/forkserver`;
  const deps = {
    psLines: async () => ({
      exitCode: 0,
      lines: [
        "101 buck2d[consumer-a] --isolation-dir v2 daemon",
        "102 buck2d[consumer-b] --isolation-dir v2 daemon",
        "201 buck2d[consumer-a] --isolation-dir v2 daemon",
        "202 buck2d[consumer-b] --isolation-dir v2 daemon",
        `301 101 (buck2-forkserver) forkserver --state-dir ${forkState(rootA, "consumer-a", "v2")}`,
        `302 102 (buck2-forkserver) forkserver --state-dir ${forkState(rootA, "consumer-b", "v2")}`,
        `401 201 (buck2-forkserver) forkserver --state-dir ${forkState(rootB, "consumer-a", "v2")}`,
        `402 202 (buck2-forkserver) forkserver --state-dir ${forkState(rootB, "consumer-b", "v2")}`,
      ],
    }),
    cwdForPid: async (pid: number) => {
      if (pid === 101) return `${rootA}/consumer-a/buck-out/v2`;
      if (pid === 102) return `/private${rootA}/consumer-b/buck-out/v2`;
      if (pid === 201) return `${rootB}/consumer-a/buck-out/v2`;
      if (pid === 202) return `/private${rootB}/consumer-b/buck-out/v2`;
      return "";
    },
  };

  const fakeZx = () => {
    throw new Error("process discovery should be injected by the test");
  };

  const buck2dA = await buck2dProcsForRepo(rootA, fakeZx, deps);
  const forksA = await forkserversUnderRepo(rootA, fakeZx, deps);
  const buck2dB = await buck2dProcsForRepo(rootB, fakeZx, deps);
  const forksB = await forkserversUnderRepo(rootB, fakeZx, deps);

  assert.deepEqual(
    buck2dA.map((p) => p.pid),
    [101, 102],
  );
  assert.deepEqual(
    forksA.map((p) => p.pid),
    [301, 302],
  );
  assert.deepEqual(
    buck2dB.map((p) => p.pid),
    [201, 202],
  );
  assert.deepEqual(
    forksB.map((p) => p.pid),
    [401, 402],
  );
});
