#!/usr/bin/env zx-wrapper

export const WORKER_POOL_DECISION_SCHEMA = "resource-graph-worker-pool-decision@1";
export const WORKER_POOL_DECISION_OUTCOMES = [
  "defer",
  "propose-worker-pool",
  "needs-more-evidence",
] as const;

export type WorkerPoolDecisionOutcome = (typeof WORKER_POOL_DECISION_OUTCOMES)[number];

export type WorkerPoolDecisionRecord = {
  schemaVersion: typeof WORKER_POOL_DECISION_SCHEMA;
  outcome: WorkerPoolDecisionOutcome;
  evidenceInputs: string[];
  schedulerBoundary: "no-scheduler-authority";
  workflowClass?: string;
  supportingEvidence?: string[];
};

const CONCRETE_WORKFLOW_CLASSES = new Set([
  "remote-build",
  "deployment-worker-capacity",
  "customer-hosted-execution",
  "regulated-placement",
]);

export function validateWorkerPoolDecisionRecord(record: unknown): WorkerPoolDecisionRecord {
  const value = record as Partial<WorkerPoolDecisionRecord>;
  if (value.schemaVersion !== WORKER_POOL_DECISION_SCHEMA) {
    throw new Error(`WorkerPool decision record must use ${WORKER_POOL_DECISION_SCHEMA}`);
  }
  if (!WORKER_POOL_DECISION_OUTCOMES.includes(value.outcome as WorkerPoolDecisionOutcome)) {
    throw new Error("WorkerPool decision outcome is not allowed");
  }
  if (!Array.isArray(value.evidenceInputs) || value.evidenceInputs.length === 0) {
    throw new Error("WorkerPool decision requires evidenceInputs");
  }
  if (value.schedulerBoundary !== "no-scheduler-authority") {
    throw new Error("WorkerPool decision must preserve no-scheduler authority boundary");
  }
  if (value.outcome === "propose-worker-pool") validateProposal(value);
  else validateNonProposal(value);
  return value as WorkerPoolDecisionRecord;
}

export function decisionAuthorizesSchedulerWork(record: WorkerPoolDecisionRecord): false {
  validateWorkerPoolDecisionRecord(record);
  return false;
}

function validateProposal(value: Partial<WorkerPoolDecisionRecord>) {
  if (!value.workflowClass || !CONCRETE_WORKFLOW_CLASSES.has(value.workflowClass)) {
    throw new Error("propose-worker-pool requires a concrete workflow class");
  }
  if (!Array.isArray(value.supportingEvidence) || value.supportingEvidence.length === 0) {
    throw new Error("propose-worker-pool requires supporting evidence");
  }
  for (const evidence of value.supportingEvidence) {
    if (!value.evidenceInputs?.includes(evidence)) {
      throw new Error("supporting evidence must be named in evidenceInputs");
    }
  }
}

function validateNonProposal(value: Partial<WorkerPoolDecisionRecord>) {
  if (value.workflowClass) {
    throw new Error(`${value.outcome} must not name a WorkerPool workflow class`);
  }
  if (value.supportingEvidence?.length) {
    throw new Error(`${value.outcome} must not authorize WorkerPool supporting evidence`);
  }
}
