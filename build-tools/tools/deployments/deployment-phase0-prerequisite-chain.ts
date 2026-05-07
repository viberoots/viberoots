#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import {
  latestSuccessfulDeploymentRecord,
  type DeploymentRunRecordLike,
} from "./deployment-admission-records";
import { assertFoundationMigrationPrerequisite } from "./deployment-foundation-prerequisites";
import { parsePhase0ReleaseMember } from "./deployment-phase0-release";

export async function assertPhase0ConsoleMigrationChain(opts: {
  workspaceRoot: string;
  recordsRoot: string;
  deployment: DeploymentTarget;
  prerequisiteId: string;
  requiredRevision: string;
  prerequisiteRecord: DeploymentRunRecordLike;
  backendDatabaseUrl?: string;
  deploymentMap: Map<string, DeploymentTarget>;
  providerMap: Map<string, string>;
  explicitProviders: Record<string, string>;
}) {
  const deploymentMember = parsePhase0ReleaseMember(opts.deployment.deploymentId);
  const prerequisiteMember = parsePhase0ReleaseMember(opts.prerequisiteId);
  if (deploymentMember?.component !== "console" || prerequisiteMember?.component !== "web") return;
  const foundationId =
    foundationIdForWebChain(opts.deploymentMap, opts.prerequisiteId) ||
    `platform-foundation-${deploymentMember.stage}`;
  if (!foundationId) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `${opts.deployment.deploymentId} requires web prerequisite migration evidence for platform-foundation-${deploymentMember.stage}`,
    );
  }
  const hit = await latestSuccessfulDeploymentRecord({
    workspaceRoot: opts.workspaceRoot,
    recordsRoot: opts.recordsRoot,
    deploymentId: foundationId,
    ...(providerFor(opts, foundationId) ? { provider: providerFor(opts, foundationId) } : {}),
    backendDatabaseUrl: opts.backendDatabaseUrl,
  });
  assertFoundationRecord({
    foundationId,
    record: hit?.record,
    requiredRevision: prerequisiteSourceRevision(opts.prerequisiteRecord) || opts.requiredRevision,
  });
}

function foundationIdForWebChain(
  deploymentMap: Map<string, DeploymentTarget>,
  webId: string,
): string | undefined {
  const web = deploymentMap.get(webId);
  const workerId = web?.prerequisites.find(
    (entry) => parsePhase0ReleaseMember(entry.deploymentId)?.component === "worker",
  )?.deploymentId;
  const worker = workerId ? deploymentMap.get(workerId) : undefined;
  return worker?.prerequisites.find(
    (entry) => parsePhase0ReleaseMember(entry.deploymentId)?.component === "foundation",
  )?.deploymentId;
}

function assertFoundationRecord(opts: {
  foundationId: string;
  record: DeploymentRunRecordLike | undefined;
  requiredRevision: string;
}) {
  if (!opts.record) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      `prerequisite deployment has no successful admitted run: ${opts.foundationId}`,
    );
  }
  assertFoundationMigrationPrerequisite({
    prerequisiteId: opts.foundationId,
    record: opts.record,
    requiredRevision: opts.requiredRevision,
  });
}

function prerequisiteSourceRevision(record: DeploymentRunRecordLike) {
  return (
    record.admittedContext?.source?.sourceRevision ||
    record.foundationMigrationOutcome?.sourceRevision ||
    ""
  );
}

function providerFor(
  opts: {
    explicitProviders: Record<string, string>;
    providerMap: Map<string, string>;
  },
  deploymentId: string,
) {
  return opts.explicitProviders[deploymentId] || opts.providerMap.get(deploymentId);
}
