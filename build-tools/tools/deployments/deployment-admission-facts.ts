#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import { sourceRevisionFor, type AdmittedContextLike } from "./deployment-admitted-context";
import {
  createDeploymentAdmissionBinding,
  requiredCheckSubjectsFor,
  type DeploymentAdmissionOperationKind,
} from "./deployment-admission-binding";
import type {
  DeploymentAdmissionCheckFact,
  DeploymentAdmissionEvidence,
  DeploymentCheckEvidence,
  DeploymentPolicyBinding,
  DeploymentPrerequisiteFact,
} from "./deployment-admission-evidence";
import {
  latestSuccessfulDeploymentRecord,
  sourceAdmissionChecks,
  type DeploymentRunRecordLike,
} from "./deployment-admission-records";
import { assertFoundationMigrationPrerequisite } from "./deployment-foundation-prerequisites";
import { validatePhase0PrerequisiteRecord } from "./deployment-phase0-admission";
import { assertPhase0ConsoleMigrationChain } from "./deployment-phase0-prerequisite-chain";
import { parsePhase0ReleaseMember } from "./deployment-phase0-release";
import {
  deploymentsForWorkspace,
  prerequisiteProvidersForWorkspace,
} from "./deployment-prerequisite-workspace";
import { trustedCheck } from "./deployment-check-trust";

export function requiredCheckFacts(opts: {
  deployment: DeploymentTarget;
  operationKind: DeploymentAdmissionOperationKind;
  binding: DeploymentPolicyBinding;
  sourceRecord?: DeploymentRunRecordLike;
  evidence?: DeploymentAdmissionEvidence;
}): DeploymentAdmissionCheckFact[] {
  const subjects = new Set(requiredCheckSubjectsFor(opts.operationKind, opts.binding));
  const currentEvidence = (opts.evidence?.checks || []).filter(
    (check) => check.status === "passed",
  );
  const current = currentEvidence
    .filter((check) => subjects.has(check.subject) && checkScopeMatches(opts.deployment, check))
    .map((check) => ({
      name: check.name,
      subject: check.subject,
      checkedAt: check.checkedAt,
      ...(check.deploymentId ? { deploymentId: check.deploymentId } : {}),
      ...(check.environmentStage ? { environmentStage: check.environmentStage } : {}),
      ...(check.admissionPolicyRef ? { admissionPolicyRef: check.admissionPolicyRef } : {}),
      ...(check.recordRef ? { recordRef: check.recordRef } : {}),
      ...(check.reportingKind ? { reportingKind: check.reportingKind } : {}),
      ...(check.reporterIdentity ? { reporterIdentity: check.reporterIdentity } : {}),
    }));
  const carriedEvidence = sourceAdmissionChecks(opts.sourceRecord);
  const carried = carriedEvidence.filter(
    (check) => subjects.has(check.subject) && checkScopeMatches(opts.deployment, check),
  );
  return opts.deployment.admissionPolicy.requiredChecks.map((name) => {
    const hit =
      trustedCheck(current, opts.deployment, name) || trustedCheck(carried, opts.deployment, name);
    if (!hit) {
      const mismatchedSubjects = Array.from(
        new Set(
          [...currentEvidence, ...carriedEvidence]
            .filter((check) => check.name === name && !subjects.has(check.subject))
            .map((check) => check.subject),
        ),
      );
      const requiredSubjects = Array.from(subjects);
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        mismatchDetail({
          operationKind: opts.operationKind,
          name,
          requiredSubjects,
          mismatchedSubjects,
        }),
      );
    }
    return hit;
  });
}

function checkScopeMatches(
  deployment: { deploymentId: string; environmentStage: string; admissionPolicyRef: string },
  check: DeploymentCheckEvidence | DeploymentAdmissionCheckFact,
) {
  return (
    check.deploymentId === deployment.deploymentId &&
    check.environmentStage === deployment.environmentStage &&
    check.admissionPolicyRef === deployment.admissionPolicyRef
  );
}

function mismatchDetail(opts: {
  operationKind: DeploymentAdmissionOperationKind;
  name: string;
  requiredSubjects: string[];
  mismatchedSubjects: string[];
}) {
  if (opts.operationKind === "deploy" && opts.requiredSubjects.length === 1) {
    const requiredCommit = opts.requiredSubjects[0] || "";
    if (opts.mismatchedSubjects.length === 1) {
      return `protected/shared admission requires check ${opts.name} for commit ${requiredCommit}, but found passed ${opts.name} for commit ${opts.mismatchedSubjects[0]}. Mark the check passed for ${requiredCommit} and retry the deploy.`;
    }
    if (opts.mismatchedSubjects.length > 1) {
      return `protected/shared admission requires check ${opts.name} for commit ${requiredCommit}, but found passed ${opts.name} for commits ${opts.mismatchedSubjects.join(", ")}. Mark the check passed for ${requiredCommit} and retry the deploy.`;
    }
  }
  if (opts.mismatchedSubjects.length > 0) {
    return `protected/shared admission requires check ${opts.name} for subject(s) ${opts.requiredSubjects.join(", ")}, but found passed ${opts.name} for subject(s) ${opts.mismatchedSubjects.join(", ")}. Re-run the check for the required subject and retry the deploy.`;
  }
  return `protected/shared admission requires check ${opts.name} for subject(s) ${opts.requiredSubjects.join(", ")}`;
}

export async function prerequisiteFacts(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: DeploymentTarget;
  admittedContext: AdmittedContextLike;
  backendDatabaseUrl?: string;
  prerequisiteProvidersByDeploymentId?: Record<string, string>;
  evidence?: DeploymentAdmissionEvidence;
}): Promise<DeploymentPrerequisiteFact[]> {
  const facts: DeploymentPrerequisiteFact[] = [];
  const prerequisites = opts.deployment.prerequisites;
  if (prerequisites.length === 0) return facts;
  const explicitProviders = opts.prerequisiteProvidersByDeploymentId || {};
  const deploymentMember = parsePhase0ReleaseMember(opts.deployment.deploymentId);
  const needsPhase0Chain = deploymentMember?.component === "console";
  const needsWorkspaceDiscovery = prerequisites.some(
    (prerequisite) => !explicitProviders[prerequisite.deploymentId],
  );
  const providerMap = needsWorkspaceDiscovery
    ? await prerequisiteProvidersForWorkspace(opts.workspaceRoot)
    : new Map<string, string>();
  const deploymentMap =
    needsWorkspaceDiscovery || needsPhase0Chain
      ? await deploymentsForWorkspace(opts.workspaceRoot)
      : new Map<string, DeploymentTarget>();
  for (const prerequisite of prerequisites) {
    const prerequisiteProvider =
      explicitProviders[prerequisite.deploymentId] || providerMap.get(prerequisite.deploymentId);
    const hit = await latestSuccessfulDeploymentRecord({
      workspaceRoot: opts.workspaceRoot,
      recordsRoot: opts.recordsRoot,
      deploymentId: prerequisite.deploymentId,
      ...(prerequisiteProvider ? { provider: prerequisiteProvider } : {}),
      backendDatabaseUrl: opts.backendDatabaseUrl,
    });
    if (!hit) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `prerequisite deployment has no successful admitted run: ${prerequisite.deploymentId}`,
      );
    }
    if (prerequisite.deploymentId.startsWith("platform-foundation-")) {
      assertFoundationMigrationPrerequisite({
        prerequisiteId: prerequisite.deploymentId,
        record: hit.record,
        requiredRevision: sourceRevisionFor(opts.admittedContext, undefined),
      });
    }
    const phase0RecordErrors = validatePhase0PrerequisiteRecord({
      deployment: opts.deployment,
      prerequisiteId: prerequisite.deploymentId,
      record: hit.record,
      admittedContext: opts.admittedContext,
    });
    if (phase0RecordErrors.length > 0) {
      throw new DeploymentAdmissionError("no_longer_admitted", phase0RecordErrors.join("\n"));
    }
    if (prerequisite.deploymentId.startsWith("platform-foundation-")) {
      facts.push({
        deploymentId: prerequisite.deploymentId,
        mode: prerequisite.mode,
        sourceDeployRunId: hit.sourceDeployRunId,
      });
      continue;
    }
    const retainedUrls = {
      ...(hit.record.publicUrl ? { publicUrl: hit.record.publicUrl } : {}),
      ...(hit.record.healthUrl ? { healthUrl: hit.record.healthUrl } : {}),
    };
    if (prerequisite.mode === "health_gated") {
      if (!hit.record.publicUrl && !hit.record.healthUrl) {
        throw new DeploymentAdmissionError(
          "no_longer_admitted",
          `health_gated prerequisite is underspecified: ${prerequisite.deploymentId}`,
        );
      }
      const health = (opts.evidence?.prerequisiteHealth || []).find(
        (entry) => entry.deploymentId === prerequisite.deploymentId && entry.status === "healthy",
      );
      if (!health) {
        throw new DeploymentAdmissionError(
          "no_longer_admitted",
          `health_gated prerequisite lacks fresh health evidence: ${prerequisite.deploymentId}`,
        );
      }
      await assertPhase0ConsoleMigrationChain({
        ...opts,
        prerequisiteId: prerequisite.deploymentId,
        requiredRevision: sourceRevisionFor(opts.admittedContext, undefined),
        prerequisiteRecord: hit.record,
        deploymentMap,
        providerMap,
        explicitProviders,
      });
      facts.push({
        deploymentId: prerequisite.deploymentId,
        mode: prerequisite.mode,
        sourceDeployRunId: hit.sourceDeployRunId,
        ...retainedUrls,
        checkedAt: health.checkedAt,
        ...(health.evidenceRef ? { healthEvidenceRef: health.evidenceRef } : {}),
      });
      continue;
    }
    facts.push({
      deploymentId: prerequisite.deploymentId,
      mode: prerequisite.mode,
      sourceDeployRunId: hit.sourceDeployRunId,
      ...retainedUrls,
    });
  }
  return facts;
}
