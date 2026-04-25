#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors.ts";
import {
  createDeploymentAdmissionBinding,
  requiredCheckSubjectsFor,
  type DeploymentAdmissionOperationKind,
} from "./deployment-admission-binding.ts";
import type {
  DeploymentAdmissionCheckFact,
  DeploymentAdmissionEvidence,
  DeploymentPolicyBinding,
  DeploymentPrerequisiteFact,
} from "./deployment-admission-evidence.ts";
import { resolveAllDeployments } from "./deployment-query.ts";
import {
  latestSuccessfulDeploymentRecord,
  sourceAdmissionChecks,
  type DeploymentRunRecordLike,
} from "./deployment-admission-records.ts";

export type AdmittedContextLike = {
  source: {
    sourceRevision: string;
    artifactIdentity?: string;
    sourceRunId?: string;
  };
  targetEnvironment: {
    providerTargetIdentity: string;
  };
};

export function sourceRevisionFor(
  admittedContext: AdmittedContextLike,
  sourceRecord?: DeploymentRunRecordLike,
) {
  const replayRevision = (sourceRecord as any)?.admittedContext?.source?.sourceRevision;
  return typeof replayRevision === "string" && replayRevision.trim()
    ? replayRevision.trim()
    : admittedContext.source.sourceRevision;
}

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
    .filter((check) => subjects.has(check.subject))
    .map((check) => ({
      name: check.name,
      subject: check.subject,
      checkedAt: check.checkedAt,
      ...(check.recordRef ? { recordRef: check.recordRef } : {}),
      ...(check.reportingKind ? { reportingKind: check.reportingKind } : {}),
    }));
  const carriedEvidence = sourceAdmissionChecks(opts.sourceRecord);
  const carried = carriedEvidence.filter((check) => subjects.has(check.subject));
  return opts.deployment.admissionPolicy.requiredChecks.map((name) => {
    const hit =
      current.find((check) => check.name === name) || carried.find((check) => check.name === name);
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

const prerequisiteProviderMaps = new Map<string, Promise<Map<string, string>>>();

async function prerequisiteProvidersForWorkspace(workspaceRoot: string) {
  let hit = prerequisiteProviderMaps.get(workspaceRoot);
  if (!hit) {
    hit = resolveAllDeployments(workspaceRoot)
      .then(
        (deployments) =>
          new Map(deployments.map((deployment) => [deployment.deploymentId, deployment.provider])),
      )
      .catch(() => new Map<string, string>());
    prerequisiteProviderMaps.set(workspaceRoot, hit);
  }
  return await hit;
}

export async function prerequisiteFacts(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: DeploymentTarget;
  backendDatabaseUrl?: string;
  prerequisiteProvidersByDeploymentId?: Record<string, string>;
  evidence?: DeploymentAdmissionEvidence;
}): Promise<DeploymentPrerequisiteFact[]> {
  const facts: DeploymentPrerequisiteFact[] = [];
  const providerMap = await prerequisiteProvidersForWorkspace(opts.workspaceRoot);
  for (const prerequisite of opts.deployment.prerequisites) {
    const prerequisiteProvider =
      opts.prerequisiteProvidersByDeploymentId?.[prerequisite.deploymentId] ||
      providerMap.get(prerequisite.deploymentId);
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
