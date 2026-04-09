#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import type { DeploymentPrerequisiteMode, DeploymentTarget } from "./contract-types.ts";
import {
  createDeploymentExtractionContext,
  deploymentError,
  uniqueErrors,
} from "./contract-extract-shared.ts";
import { extractCloudflarePagesDeploymentsFromContext } from "./contract-extract-cloudflare-pages.ts";
import { extractKubernetesDeploymentsFromContext } from "./contract-extract-kubernetes.ts";
import { extractNixosSharedHostDeploymentsFromContext } from "./contract-extract-nixos-shared-host.ts";
import { extractS3StaticDeploymentsFromContext } from "./contract-extract-s3-static.ts";

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

export function extractDeployments(nodes: GraphNode[]): {
  deployments: DeploymentTarget[];
  errors: string[];
} {
  const context = createDeploymentExtractionContext(nodes);
  const deployments = [
    ...extractNixosSharedHostDeploymentsFromContext(context),
    ...extractCloudflarePagesDeploymentsFromContext(context),
    ...extractS3StaticDeploymentsFromContext(context),
    ...extractKubernetesDeploymentsFromContext(context),
  ].sort((a, b) => a.label.localeCompare(b.label));
  context.errors.push(...validateDeploymentPrerequisites(deployments));
  return {
    deployments,
    errors: uniqueErrors(context.errors),
  };
}
