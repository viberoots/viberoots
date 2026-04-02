#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeVerifyTimingFromLogText,
  formatVerifyTimingAnalysisText,
} from "../../dev/analyze-verify-timing.ts";

test("analyze-verify-timing: aggregates buckets, parses durations, and computes parallelism", () => {
  const log = [
    "[verify] buck2 test begin iso=v-123 start_s=1000",
    "[timing] summary (sorted by total):",
    "[timing] 300.0ms total  (3x, avg 100.0ms): rsyncRepoTo(tmp-aaa)",
    "[timing] scafNew refreshImporterStoreHash: 25.0ms",
    "✓ Pass: root//:slow_a (45.0s)",
    "✓ Pass: root//:a (1.0s)",
    "✗ Fail: root//:b (2.5s)",
    "# ✓ Pass: root//:nested (99.0s)",
    "[timing] 40.0ms total  (1x, avg 40.0ms): zx-init probe (node --import zx-init)",
    "[timing] summary (sorted by total):",
    "[timing] 200.0ms total  (2x, avg 100.0ms): rsyncRepoTo(tmp-bbb)",
    "[verify] buck2 test exit iso=v-123 status=1 end_s=1002",
  ].join("\n");

  const a = analyzeVerifyTimingFromLogText({ logPath: "/repo/verify.log", text: log });

  assert.equal(a.wallSec, 2);
  assert.equal(a.testsWithDurations, 3);
  assert.equal(a.sumTestDurationsSec, 48.5);
  assert.ok(a.effectiveParallelism !== undefined && a.effectiveParallelism > 1.0);

  const rsync = a.buckets.find((b) => b.label === "rsyncRepoTo(...)");
  assert.ok(rsync, "expected rsyncRepoTo(...) bucket");
  assert.equal(rsync?.count, 5);
  assert.equal(rsync?.msTotal, 500);
  const hashRefresh = a.buckets.find((b) => b.label === "scafNew refreshImporterStoreHash");
  assert.ok(hashRefresh, "expected detail-only scaffold bucket");
  assert.equal(hashRefresh?.count, 1);
  assert.equal(hashRefresh?.msTotal, 25);
  assert.equal(a.targetTimings.length, 1);
  assert.equal(a.targetTimings[0]?.target, "root//:slow_a");

  const out = formatVerifyTimingAnalysisText(a, {
    maxBuckets: 10,
    comment: true,
    slowTargetSec: 30,
  });
  assert.match(out, /^\# \[timing\] aggregate: log=/m);
  assert.match(out, /\# \[timing\] aggregate: wall=2\.00s start_s=1000 end_s=1002/m);
  assert.match(out, /\# \[timing\] aggregate: tests_with_durations=3/m);
  assert.match(out, /\# \[timing\] aggregate: sum_test_durations=48\.50s/m);
  assert.match(
    out,
    /\# \[timing\] 0\.50s total \(5x, avg 100\.00ms\) est_wall=.*s: rsyncRepoTo\(/m,
  );
  assert.match(out, /\# \[timing\] slow-target 45\.00s pass root\/\/:slow_a \(45\.0s\)/m);
  assert.match(
    out,
    /\# \[timing\] target-bucket 0\.30s total \(3x, avg 100\.00ms\): rsyncRepoTo\(\.\.\.\)/m,
  );
});
