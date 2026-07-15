#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { createVerifyProgressReporter } from "../../dev/verify/progress-line";
import {
  computeVerifyStatusFromLogText,
  formatVerifyStatusText,
} from "../../lib/verify-log-status";

test("project enforcement uses normal verify and status progress rows", () => {
  const writes: string[] = [];
  const reporter = createVerifyProgressReporter({
    enabled: true,
    passes: [{ name: "project-enforcement", total: 1 }],
    now: () => 1_000,
    stream: { isTTY: false, write: (chunk) => writes.push(String(chunk)) },
    env: { NO_COLOR: "1" },
  });
  reporter.start();
  reporter.update("project-enforcement", { completed: 1, status: "done" });
  reporter.stop({ clear: false });
  assert.match(writes.join(""), /  test   project-enforcement \[█{24}\] 1\/1 done 0s/);

  const text = [
    "[verify] begin iso=v-1 start_s=1",
    "[verify] expanded targets: concrete=2 pass_count=2 isolated_passes=1 isolated_targets=1 shared_targets=1",
    "[verify] target pass begin name=project-enforcement index=1/2 target_count=1 targets=workspace_buck//:policy",
    "✓ Pass: workspace_buck//:policy (0.1s)",
    "[verify] buck2 test exit iso=v-1-project-enforcement pass=project-enforcement status=0 end_s=2 duration_s=1 pass_count=1 fail_count=0 completions=1 threads=1",
    "[verify] target pass end name=project-enforcement index=1/2 status=0",
    "[verify] target pass begin name=shared index=2/2 target_count=1 targets=viberoots//:shared",
  ].join("\n");
  const status = computeVerifyStatusFromLogText({ logPath: "/tmp/verify.log", pid: 1, text });
  const output = formatVerifyStatusText(status, { isTty: false });
  assert.match(output, /project-enforcement \[█{24}\] 1\/1 done/);
  assert.doesNotMatch(output, /test project-enforcement/);
});
