#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentAdmissionEvidence } from "../../deployments/deployment-admission-cli.ts";
import { runInTemp } from "../lib/test-helpers.ts";

function withSyntheticArgv(args: string[], fn: () => Promise<void>): Promise<void> {
  const oldGlobal = (globalThis as Record<string, unknown>).argv;
  const oldArgv = process.argv.slice();
  delete (globalThis as Record<string, unknown>).argv;
  process.argv = ["node", "script", ...args];
  return fn().finally(() => {
    (globalThis as Record<string, unknown>).argv = oldGlobal;
    process.argv = oldArgv;
  });
}

test("mark-check-passed infers the current HEAD subject and synthesizes passed checks", async () => {
  await runInTemp("deployment-admission-cli-mark-check-passed", async (tmp, $) => {
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      const head = String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout).trim();
      await withSyntheticArgv(
        ["--mark-check-passed=deploy/pleomino-dev, deploy/pleomino-dev"],
        async () => {
          const evidence = await resolveDeploymentAdmissionEvidence();
          assert.ok(evidence);
          assert.deepEqual(
            evidence.checks?.map((entry) => entry.name),
            ["deploy/pleomino-dev"],
          );
          assert.equal(evidence.checks?.[0]?.subject, head);
          assert.equal(evidence.checks?.[0]?.status, "passed");
          assert.match(String(evidence.checks?.[0]?.checkedAt), /^\d{4}-\d{2}-\d{2}T/);
          assert.equal(evidence.checks?.[0]?.recordRef, "manual-check://deploy/pleomino-dev");
        },
      );
    } finally {
      process.chdir(oldCwd);
    }
  });
});

test("mark-check-passed merges with admission-evidence-json and overrides duplicate checks", async () => {
  await runInTemp("deployment-admission-cli-merge", async (tmp, $) => {
    const oldCwd = process.cwd();
    try {
      process.chdir(tmp);
      const head = String((await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout).trim();
      const evidencePath = path.join(tmp, "admission-evidence.json");
      await fsp.writeFile(
        evidencePath,
        JSON.stringify({
          requestedBy: { principalId: "user:bootstrap" },
          checks: [
            {
              name: "deploy/pleomino-dev",
              subject: head,
              status: "failed",
              checkedAt: "2026-04-23T00:00:00.000Z",
              recordRef: "manual://old",
            },
            {
              name: "deploy/other",
              subject: "sha256:elsewhere",
              status: "passed",
              checkedAt: "2026-04-23T00:00:00.000Z",
              recordRef: "manual://other",
            },
          ],
        }),
      );
      await withSyntheticArgv(
        ["--admission-evidence-json", evidencePath, "--mark-check-passed=deploy/pleomino-dev"],
        async () => {
          const evidence = await resolveDeploymentAdmissionEvidence();
          assert.equal(evidence?.requestedBy?.principalId, "user:bootstrap");
          assert.deepEqual(
            evidence?.checks?.map((entry) => [
              entry.name,
              entry.subject,
              entry.status,
              entry.recordRef,
            ]),
            [
              ["deploy/pleomino-dev", head, "passed", "manual-check://deploy/pleomino-dev"],
              ["deploy/other", "sha256:elsewhere", "passed", "manual://other"],
            ],
          );
        },
      );
    } finally {
      process.chdir(oldCwd);
    }
  });
});
