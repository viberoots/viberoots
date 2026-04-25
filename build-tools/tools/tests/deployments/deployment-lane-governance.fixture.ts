#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  CLOUDFLARE_PAGES_PROVIDER,
  KUBERNETES_PROVIDER,
  NIXOS_SHARED_HOST_PROVIDER,
  S3_STATIC_PROVIDER,
  type CloudflarePagesDeployment,
  type KubernetesDeployment,
  type NixosSharedHostDeployment,
  type S3StaticDeployment,
} from "../../deployments/contract.ts";
import {
  DEPLOYMENT_LANE_GOVERNANCE_RULE,
  type DeploymentLaneGovernance,
  type DeploymentScmBackend,
} from "../../deployments/deployment-lane-governance.ts";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query.ts";
import type { DeploymentAdmissionEvidence } from "../../deployments/deployment-admission-evidence.ts";
import type { GraphNode } from "../../lib/graph.ts";
import {
  installCloudflarePagesTargets,
  installKubernetesTargets,
  installNixosSharedHostTargets,
  installS3StaticTargets,
} from "./deployment-targets.install.helpers.ts";

export function nixosSharedHostLaneGovernanceFixture(
  overrides: Partial<DeploymentLaneGovernance> = {},
): DeploymentLaneGovernance {
  return {
    ref: overrides.ref || "//projects/deployments/pleomino-shared:lane_governance",
    name: overrides.name || "lane_governance",
    scmBackend: (overrides.scmBackend || "github") as DeploymentScmBackend,
    repository: overrides.repository || "kiltyj/bucknix-fresh",
    branchProtections: overrides.branchProtections || [
      {
        stage: "dev",
        branch: "env/pleomino/dev",
        requiredChecks: ["deploy/pleomino-dev"],
        fastForwardOnly: true,
        normalAdvancePrincipals: ["app:deploy-bot"],
        emergencyDirectPushPrincipals: ["team:sre-break-glass"],
      },
      {
        stage: "staging",
        branch: "env/pleomino/staging",
        requiredChecks: ["deploy/pleomino-staging"],
        fastForwardOnly: true,
        normalAdvancePrincipals: ["app:deploy-bot"],
        emergencyDirectPushPrincipals: ["team:sre-break-glass"],
      },
      {
        stage: "prod",
        branch: "env/pleomino/prod",
        requiredChecks: ["deploy/pleomino-prod"],
        fastForwardOnly: true,
        normalAdvancePrincipals: ["app:deploy-bot"],
        emergencyDirectPushPrincipals: ["team:sre-break-glass"],
      },
    ],
    fingerprint: overrides.fingerprint || "sha256:lane-governance-pleomino",
  };
}

export function nixosSharedHostLaneGovernanceNodeFixture(
  overrides: Partial<GraphNode> = {},
): GraphNode {
  const governance = nixosSharedHostLaneGovernanceFixture();
  return {
    name: governance.ref,
    rule_type: DEPLOYMENT_LANE_GOVERNANCE_RULE,
    scm_backend: governance.scmBackend,
    repository: governance.repository,
    branch_protections: governance.branchProtections.map((entry) => ({
      stage: entry.stage,
      branch: entry.branch,
      required_checks: entry.requiredChecks.join(","),
      fast_forward_only: "true",
      normal_advance_principals: entry.normalAdvancePrincipals.join(","),
      emergency_direct_push_principals: entry.emergencyDirectPushPrincipals.join(","),
    })),
    ...overrides,
  };
}

export function reviewedLaneAdmissionEvidenceFixture(opts: {
  deployment: {
    lanePolicyRef: string;
    lanePolicy: {
      governanceRef: string;
      governance: DeploymentLaneGovernance;
    };
  };
  requestedBy?: string;
  recordRef?: string;
}): DeploymentAdmissionEvidence {
  return {
    requestedBy: { principalId: opts.requestedBy || "user:submitter" },
    laneGovernance: {
      lanePolicyRef: opts.deployment.lanePolicyRef,
      governanceRef: opts.deployment.lanePolicy.governanceRef,
      governanceFingerprint: opts.deployment.lanePolicy.governance.fingerprint,
      verifiedAt: "2026-04-06T12:00:00.000Z",
      verificationSource: "client_supplied",
      scmBackend: opts.deployment.lanePolicy.governance.scmBackend,
      repository: opts.deployment.lanePolicy.governance.repository,
      branchProtections: opts.deployment.lanePolicy.governance.branchProtections,
      ...(opts.recordRef ? { recordRef: opts.recordRef } : {}),
    },
  };
}

export async function writeReviewedLaneAdmissionEvidenceJson(opts: {
  tmp: string;
  $: any;
  deployment: {
    admissionPolicy: {
      requiredChecks: string[];
    };
    environmentStage: string;
    label: string;
    lanePolicy: {
      stageBranches: Record<string, string>;
      governance: DeploymentLaneGovernance;
    };
    provider?: string;
  };
  deploymentLabel?: string;
  requestedBy?: string;
  includeRequiredChecks?: boolean;
}): Promise<string> {
  const deploymentLabel = opts.deploymentLabel || opts.deployment.label;
  const fileSuffix = deploymentLabel.replace(/[^a-zA-Z0-9_-]+/g, "_");
  const snapshotPath = path.join(opts.tmp, `scm-policy-${fileSuffix}.json`);
  const evidencePath = path.join(opts.tmp, `admission-evidence-${fileSuffix}.json`);
  await ensureReviewedDeploymentTargetsInstalled(opts.tmp, opts.deployment);
  const resolvedDeployment = await resolveDeploymentFromTarget(opts.tmp, deploymentLabel);
  const sourceRef = opts.deployment.lanePolicy.stageBranches[opts.deployment.environmentStage];
  const sourceRevision = opts.includeRequiredChecks
    ? String(
        (
          await opts.$({
            cwd: opts.tmp,
            stdio: "pipe",
          })`git rev-parse ${sourceRef}`
        ).stdout,
      ).trim()
    : "";
  const selectorArgs = ["--deployment", opts.deploymentLabel || opts.deployment.label];
  await fsp.writeFile(
    snapshotPath,
    JSON.stringify(
      {
        scmBackend: resolvedDeployment.lanePolicy.governance.scmBackend,
        repository: resolvedDeployment.lanePolicy.governance.repository,
        branchProtections: resolvedDeployment.lanePolicy.governance.branchProtections,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  const verified = await opts.$({
    cwd: opts.tmp,
    stdio: "pipe",
  })`zx-wrapper build-tools/tools/deployments/deployment-lane-governance-verify.ts ${selectorArgs} --scm-policy-json ${snapshotPath}`;
  await fsp.writeFile(
    evidencePath,
    JSON.stringify(
      {
        requestedBy: { principalId: opts.requestedBy || "user:submitter" },
        laneGovernance: JSON.parse(String(verified.stdout)),
        ...(opts.includeRequiredChecks && sourceRevision
          ? {
              checks: opts.deployment.admissionPolicy.requiredChecks.map((name) => ({
                name,
                subject: sourceRevision,
                status: "passed" as const,
                checkedAt: "2026-04-06T12:00:00.000Z",
                recordRef: `check://${name}`,
              })),
            }
          : {}),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return evidencePath;
}

type ReviewedFixtureDeployment =
  | CloudflarePagesDeployment
  | KubernetesDeployment
  | NixosSharedHostDeployment
  | S3StaticDeployment;

async function ensureReviewedDeploymentTargetsInstalled(
  workspaceRoot: string,
  deployment: { label: string; provider?: string },
): Promise<void> {
  try {
    await resolveDeploymentFromTarget(workspaceRoot, deployment.label);
    return;
  } catch {}
  switch (deployment.provider) {
    case NIXOS_SHARED_HOST_PROVIDER:
      await installNixosSharedHostTargets(workspaceRoot, [deployment as NixosSharedHostDeployment]);
      return;
    case CLOUDFLARE_PAGES_PROVIDER:
      await installCloudflarePagesTargets(workspaceRoot, [deployment as CloudflarePagesDeployment]);
      return;
    case S3_STATIC_PROVIDER:
      await installS3StaticTargets(workspaceRoot, [deployment as S3StaticDeployment]);
      return;
    case KUBERNETES_PROVIDER:
      await installKubernetesTargets(workspaceRoot, [deployment as KubernetesDeployment]);
      return;
    default:
      return;
  }
}
