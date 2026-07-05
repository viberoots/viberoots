#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { test } from "node:test";
import {
  decisionAuthorizesSchedulerWork,
  validateWorkerPoolDecisionRecord,
} from "../deployments/resource-graph-worker-pool-decision";
import { viberootsSourcePath } from "./lib/test-helpers/source-paths";

test("WorkerPool decision record is machine checked and keeps scheduler deferred", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      viberootsSourcePath(
        "build-tools/tools/deployments/resource-graph-worker-pool-decision.fixture.json",
      ),
      "utf8",
    ),
  );
  const decision = validateWorkerPoolDecisionRecord(fixture);
  assert.equal(decision.outcome, "needs-more-evidence");
  assert.equal(decisionAuthorizesSchedulerWork(decision), false);
  assert.throws(
    () => validateWorkerPoolDecisionRecord({ ...fixture, outcome: "schedule-workers" }),
    /outcome is not allowed/,
  );
  assert.throws(
    () => validateWorkerPoolDecisionRecord({ ...fixture, evidenceInputs: [] }),
    /requires evidenceInputs/,
  );
  assert.throws(
    () => validateWorkerPoolDecisionRecord(proposal(fixture, "abstract-workers", true)),
    /concrete workflow class/,
  );
  assert.throws(
    () => validateWorkerPoolDecisionRecord(proposal(fixture, "deployment-worker-capacity", false)),
    /requires supporting evidence/,
  );
  const proposed = validateWorkerPoolDecisionRecord(
    proposal(fixture, "deployment-worker-capacity", true),
  );
  assert.equal(proposed.workflowClass, "deployment-worker-capacity");
  assert.equal(decisionAuthorizesSchedulerWork(proposed), false);
  assert.throws(
    () =>
      validateWorkerPoolDecisionRecord({
        ...fixture,
        outcome: "defer",
        workflowClass: "deployment-worker-capacity",
      }),
    /must not name a WorkerPool workflow class/,
  );
});

function proposal(fixture: any, workflowClass: string, supportingEvidence: boolean) {
  return {
    ...fixture,
    outcome: "propose-worker-pool",
    workflowClass,
    ...(supportingEvidence ? { supportingEvidence: ["control-plane-worker-evidence@1"] } : {}),
  };
}
