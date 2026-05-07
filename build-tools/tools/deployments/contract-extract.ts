#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import type { DeploymentPrerequisiteMode, DeploymentTarget } from "./contract-types";
import {
  createDeploymentExtractionContext,
  deploymentError,
  uniqueErrors,
} from "./contract-extract-shared";
import { extractCloudflarePagesDeploymentsFromContext } from "./contract-extract-cloudflare-pages";
import { extractAppStoreConnectDeploymentsFromContext } from "./contract-extract-app-store-connect";
import { extractGooglePlayDeploymentsFromContext } from "./contract-extract-google-play";
import { extractKubernetesDeploymentsFromContext } from "./contract-extract-kubernetes";
import { extractNixosSharedHostDeploymentsFromContext } from "./contract-extract-nixos-shared-host";
import { extractOpenTofuDeploymentsFromContext } from "./contract-extract-opentofu";
import { extractS3StaticDeploymentsFromContext } from "./contract-extract-s3-static";
import { extractVercelDeploymentsFromContext } from "./contract-extract-vercel";
import {
  readExternalRequirementProfiles,
  validateExternalDeploymentRequirementProfiles,
} from "./deployment-extract-metadata";

const DEPLOYMENT_PREREQUISITE_MODES = new Set<DeploymentPrerequisiteMode>([
  "ordering_only",
  "health_gated",
]);

function validateDeploymentPrerequisites(deployments: DeploymentTarget[]): string[] {
  const errors: string[] = [];
  const byId = new Map(deployments.map((deployment) => [deployment.deploymentId, deployment]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (deployment: DeploymentTarget, stack: string[]) => {
    if (visited.has(deployment.deploymentId)) return;
    if (visiting.has(deployment.deploymentId)) {
      const cycleStart = stack.indexOf(deployment.deploymentId);
      const cycle = [...stack.slice(cycleStart), deployment.deploymentId].join(" -> ");
      errors.push(deploymentError(deployment.label, `invalid prerequisite cycle: ${cycle}`));
      return;
    }
    visiting.add(deployment.deploymentId);
    const seen = new Set<string>();
    for (const prerequisite of deployment.prerequisites) {
      if (!DEPLOYMENT_PREREQUISITE_MODES.has(prerequisite.mode)) {
        errors.push(
          deploymentError(
            deployment.label,
            `unsupported prerequisite mode "${prerequisite.mode}" for ${prerequisite.deploymentId}`,
          ),
        );
        continue;
      }
      if (prerequisite.deploymentId === deployment.deploymentId) {
        errors.push(
          deploymentError(
            deployment.label,
            `deployment cannot depend on itself: ${prerequisite.deploymentId}`,
          ),
        );
        continue;
      }
      if (seen.has(prerequisite.deploymentId)) {
        errors.push(
          deploymentError(
            deployment.label,
            `duplicate prerequisite deployment_id "${prerequisite.deploymentId}"`,
          ),
        );
        continue;
      }
      seen.add(prerequisite.deploymentId);
      const prerequisiteDeployment = byId.get(prerequisite.deploymentId);
      if (!prerequisiteDeployment) {
        errors.push(
          deploymentError(
            deployment.label,
            `unknown prerequisite deployment_id "${prerequisite.deploymentId}"`,
          ),
        );
        continue;
      }
      if (prerequisiteDeployment.lanePolicyRef !== deployment.lanePolicyRef) {
        errors.push(
          deploymentError(
            deployment.label,
            `cross-lane prerequisite "${prerequisite.deploymentId}" is not allowed`,
          ),
        );
        continue;
      }
      visit(prerequisiteDeployment, [...stack, deployment.deploymentId]);
    }
    visiting.delete(deployment.deploymentId);
    visited.add(deployment.deploymentId);
  };

  for (const deployment of deployments) visit(deployment, []);
  return errors;
}

function validateExternalRequirementMetadata(
  nodes: GraphNode[],
  deployments: DeploymentTarget[],
): string[] {
  const errors: string[] = [];
  const nodesByLabel = new Map(nodes.map((node) => [String(node.name || ""), node]));
  for (const deployment of deployments) {
    const node = nodesByLabel.get(deployment.label);
    if (!node) continue;
    deployment.externalRequirementProfiles = readExternalRequirementProfiles(node);
    validateExternalDeploymentRequirementProfiles({
      node,
      label: deployment.label,
      secretRequirements: deployment.secretRequirements,
      runtimeConfigRequirements: deployment.runtimeConfigRequirements,
      errors,
    });
  }
  return errors;
}

export function extractDeployments(nodes: GraphNode[]): {
  deployments: DeploymentTarget[];
  errors: string[];
} {
  const context = createDeploymentExtractionContext(nodes);
  const deployments = [
    ...extractNixosSharedHostDeploymentsFromContext(context),
    ...extractCloudflarePagesDeploymentsFromContext(context),
    ...extractAppStoreConnectDeploymentsFromContext(context),
    ...extractGooglePlayDeploymentsFromContext(context),
    ...extractS3StaticDeploymentsFromContext(context),
    ...extractKubernetesDeploymentsFromContext(context),
    ...extractOpenTofuDeploymentsFromContext(context),
    ...extractVercelDeploymentsFromContext(context),
  ].sort((a, b) => a.label.localeCompare(b.label));
  context.errors.push(...validateExternalRequirementMetadata(nodes, deployments));
  context.errors.push(...validateDeploymentPrerequisites(deployments));
  return {
    deployments,
    errors: uniqueErrors(context.errors),
  };
}
