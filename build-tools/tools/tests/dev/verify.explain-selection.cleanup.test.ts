#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { VerifyScopeDecision } from "../../dev/verify/requested-scope";
import { runExplainSelection } from "../../dev/verify/explain-selection";
import { parseVerifyOwnedState } from "../../dev/verify/owned-process-state";
import { parseVerifyExecutionPolicy } from "../../dev/verify/remote-policy";

function selectionFixture(): VerifyScopeDecision {
  return {
    requestedMode: "auto",
    requestedDeploymentMode: "auto",
    reason: "default",
    selectorMode: "default",
    targets: ["@viberoots//build-tools/tools/tests/dev:sample"],
    diagnostics: null,
    lintFilters: null,
  };
}

test("runExplainSelection kills the explain-selection isolation after printing", async () => {
  const calls: string[] = [];
  const executionPolicy = parseVerifyExecutionPolicy({ env: {} });
  await runExplainSelection({
    root: "/repo",
    selection: selectionFixture(),
    executionPolicy,
    resolvePlan: (opts) => {
      calls.push(`policy:${opts.executionPolicy === executionPolicy}`);
      return {
        targetLabels: [{ target: "@viberoots//build-tools/tools/tests/dev:sample", labels: [] }],
        passes: [{ name: "shared", targets: ["@viberoots//build-tools/tools/tests/dev:sample"] }],
      };
    },
    printSelection: () => {
      calls.push("printed");
    },
    killIso: async (root, iso) => {
      calls.push(`killed:${root}:${iso}`);
    },
  });
  assert.deepEqual(calls, ["policy:true", "printed", "killed:/repo:v-explain-selection"]);
});

test("runExplainSelection kills the explain-selection isolation when planning fails", async () => {
  const calls: string[] = [];
  await assert.rejects(
    async () =>
      await runExplainSelection({
        root: "/repo",
        selection: selectionFixture(),
        executionPolicy: parseVerifyExecutionPolicy({ env: {} }),
        resolvePlan: () => {
          throw new Error("boom");
        },
        killIso: async (root, iso) => {
          calls.push(`killed:${root}:${iso}`);
        },
      }),
    /boom/,
  );
  assert.deepEqual(calls, ["killed:/repo:v-explain-selection"]);
});

test("runExplainSelection registers explain-selection isolation for orphan cleanup", async () => {
  const stateFile = path.join(
    os.tmpdir(),
    `viberoots-explain-selection-${process.pid}-${Date.now()}.txt`,
  );
  const previous = process.env.VBR_VERIFY_PROCESS_STATE_FILE;
  await fsp.writeFile(stateFile, "", "utf8");
  try {
    process.env.VBR_VERIFY_PROCESS_STATE_FILE = stateFile;
    await runExplainSelection({
      root: "/repo",
      selection: selectionFixture(),
      executionPolicy: parseVerifyExecutionPolicy({ env: {} }),
      resolvePlan: () => ({
        targetLabels: [{ target: "@viberoots//build-tools/tools/tests/dev:sample", labels: [] }],
        passes: [{ name: "shared", targets: ["@viberoots//build-tools/tools/tests/dev:sample"] }],
      }),
      printSelection: () => {},
      killIso: async () => {},
    });
    const parsed = parseVerifyOwnedState(await fsp.readFile(stateFile, "utf8"));
    assert.deepEqual(
      parsed.isolations.map((entry) => ({
        iso: entry.iso,
        repoRoot: entry.repoRoot,
        kind: entry.kind,
      })),
      [
        {
          iso: "v-explain-selection",
          repoRoot: "/repo",
          kind: "verify-explain-selection",
        },
      ],
    );
  } finally {
    if (previous === undefined) delete process.env.VBR_VERIFY_PROCESS_STATE_FILE;
    else process.env.VBR_VERIFY_PROCESS_STATE_FILE = previous;
    await fsp.rm(stateFile, { force: true }).catch(() => {});
  }
});
