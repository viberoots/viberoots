#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract-types";
import type { DeploymentRunRecordLike } from "./deployment-admission-records";
import { parsePhase0ReleaseMember } from "./deployment-phase0-release";

type Phase0AdmittedContext = {
  source: {
    sourceRevision: string;
    artifactIdentity?: string;
  };
  targetEnvironment: {
    providerTargetIdentity: string;
  };
  phase0CompatibilityException?: Phase0CompatibilityException;
};

export type Phase0ReleaseRecord = {
  deploymentId: string;
  sourceRevision: string;
  lanePolicyRef: string;
  artifactIdentity: string;
  providerTargetIdentity: string;
  compatibilityException?: Phase0CompatibilityException;
};

export type Phase0CompatibilityException = {
  reviewedBy: string;
  reason: string;
  expiresAt: string;
};

export function validatePhase0CurrentAdmission(opts: {
  deployment: DeploymentTarget;
  admittedContext: Phase0AdmittedContext;
}): string[] {
  if (!parsePhase0ReleaseMember(opts.deployment.deploymentId)) return [];
  const errors: string[] = [];
  if (!opts.admittedContext.source.sourceRevision) {
    errors.push(`${opts.deployment.deploymentId} Phase 0 admission requires source revision`);
  }
  if (!opts.admittedContext.source.artifactIdentity) {
    errors.push(`${opts.deployment.deploymentId} Phase 0 admission requires artifact identity`);
  }
  if (!opts.admittedContext.targetEnvironment.providerTargetIdentity) {
    errors.push(
      `${opts.deployment.deploymentId} Phase 0 admission requires provider target identity`,
    );
  }
  if (!opts.deployment.lanePolicyRef) {
    errors.push(`${opts.deployment.deploymentId} Phase 0 admission requires lane policy`);
  }
  errors.push(...compatibilityExceptionErrors(currentReleaseRecord(opts)));
  return errors;
}

export function validatePhase0PrerequisiteRecord(opts: {
  deployment: DeploymentTarget;
  prerequisiteId: string;
  record: DeploymentRunRecordLike;
  admittedContext: Phase0AdmittedContext;
}): string[] {
  const deploymentMember = parsePhase0ReleaseMember(opts.deployment.deploymentId);
  if (!deploymentMember || !parsePhase0ReleaseMember(opts.prerequisiteId)) return [];
  const errors = validatePhase0ReleaseRecords([
    currentReleaseRecord(opts),
    recordToPhase0ReleaseRecord(opts.prerequisiteId, opts.record),
  ]);
  return errors;
}

function currentReleaseRecord(opts: {
  deployment: DeploymentTarget;
  admittedContext: Phase0AdmittedContext;
}): Phase0ReleaseRecord {
  return {
    deploymentId: opts.deployment.deploymentId,
    sourceRevision: opts.admittedContext.source.sourceRevision,
    lanePolicyRef: opts.deployment.lanePolicyRef,
    artifactIdentity: opts.admittedContext.source.artifactIdentity || "",
    providerTargetIdentity: opts.admittedContext.targetEnvironment.providerTargetIdentity,
    compatibilityException: opts.admittedContext.phase0CompatibilityException,
  };
}

function recordToPhase0ReleaseRecord(
  deploymentId: string,
  record: DeploymentRunRecordLike,
): Phase0ReleaseRecord {
  return {
    deploymentId,
    sourceRevision:
      record.admittedContext?.source?.sourceRevision ||
      record.foundationMigrationOutcome?.sourceRevision ||
      "",
    lanePolicyRef:
      record.admittedContext?.lanePolicyRef ||
      record.lanePolicyRef ||
      record.deployment?.lanePolicyRef ||
      "",
    artifactIdentity: record.artifact?.identity || record.artifactLineageId || "",
    providerTargetIdentity:
      record.providerTargetIdentity ||
      record.effectiveRunTarget?.providerTargetIdentity ||
      record.admittedContext?.targetEnvironment?.providerTargetIdentity ||
      "",
    compatibilityException: normalizeRecordException(record),
  };
}

function normalizeRecordException(
  record: DeploymentRunRecordLike,
): Phase0CompatibilityException | undefined {
  const exception =
    record.admittedContext?.phase0CompatibilityException || record.phase0CompatibilityException;
  if (!exception) return undefined;
  return {
    reviewedBy: exception.reviewedBy || "",
    reason: exception.reason || "",
    expiresAt: exception.expiresAt || "",
  };
}

export function validatePhase0ReleaseRecords(records: Phase0ReleaseRecord[]): string[] {
  const errors: string[] = [];
  const phase0Records = records.filter((record) => parsePhase0ReleaseMember(record.deploymentId));
  const releaseRevision =
    phase0Records.find((record) => record.sourceRevision)?.sourceRevision || "";
  const releaseLanePolicy =
    phase0Records.find((record) => record.lanePolicyRef)?.lanePolicyRef || "";
  const revisions = new Set(phase0Records.map((record) => record.sourceRevision));
  const lanePolicies = new Set(phase0Records.map((record) => record.lanePolicyRef));
  const exceptionErrors = new Map<Phase0ReleaseRecord, string[]>();
  for (const record of phase0Records) {
    const recordErrors = compatibilityExceptionErrors(record);
    exceptionErrors.set(record, recordErrors);
    errors.push(...recordErrors);
  }
  if (releaseLanePolicy && lanePolicies.size > 1) {
    for (const record of phase0Records) {
      if (record.lanePolicyRef !== releaseLanePolicy) {
        errors.push(`${record.deploymentId} lane policy differs from Phase 0 release group`);
      }
    }
  }
  if (releaseRevision && revisions.size > 1) {
    const releaseRecord = phase0Records.find((record) => record.sourceRevision === releaseRevision);
    const releaseHasException =
      !!releaseRecord?.compatibilityException && exceptionErrors.get(releaseRecord)?.length === 0;
    for (const record of phase0Records) {
      if (record.sourceRevision === releaseRevision) continue;
      const recordHasException =
        !!record.compatibilityException && exceptionErrors.get(record)?.length === 0;
      if (!releaseHasException && !recordHasException) {
        errors.push(`${record.deploymentId} source revision differs without reviewed exception`);
      }
    }
  }
  for (const record of phase0Records) {
    if (!record.artifactIdentity)
      errors.push(`${record.deploymentId} is missing artifact identity`);
    if (!record.providerTargetIdentity) {
      errors.push(`${record.deploymentId} is missing provider target identity`);
    }
  }
  return errors;
}

function compatibilityExceptionErrors(record: Phase0ReleaseRecord): string[] {
  const exception = record.compatibilityException;
  if (!exception) return [];
  const expiresAtMs = Date.parse(exception.expiresAt);
  return [
    !exception.reviewedBy ? `${record.deploymentId} compatibility exception lacks reviewer` : "",
    !exception.reason ? `${record.deploymentId} compatibility exception lacks reason` : "",
    !exception.expiresAt ? `${record.deploymentId} compatibility exception lacks expiration` : "",
    exception.expiresAt && Number.isNaN(expiresAtMs)
      ? `${record.deploymentId} compatibility exception has invalid expiration`
      : "",
    Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()
      ? `${record.deploymentId} compatibility exception has expired`
      : "",
  ].filter(Boolean);
}
