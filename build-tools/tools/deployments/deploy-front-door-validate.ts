#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GraphNode } from "../lib/graph";
import type { DeploymentComponent, DeploymentTarget } from "./contract";
import { DEPLOYMENT_CQUERY_ATTRS } from "./deployment-query-attrs";
import { queryDeploymentNodesWithAttrs } from "./deployment-query";
import { pushAppStoreConnectComponentKindErrors } from "./app-store-connect-capability-validation";
import { prepareAppStoreConnectPublisherConfig } from "./app-store-connect-config";
import { pushCloudflareComponentKindErrors } from "./cloudflare-pages-capability-validation";
import { prepareCloudflarePagesWranglerConfig } from "./cloudflare-pages-config";
import { pushGooglePlayComponentKindErrors } from "./google-play-capability-validation";
import { prepareGooglePlayPublisherConfig } from "./google-play-config";
import { isSupportedComponentNode } from "./deployment-component-kinds";
import { prepareKubernetesPublisherConfig } from "./kubernetes-config";
import { pushKubernetesComponentKindErrors } from "./kubernetes-capability-validation";
import type { NixosSharedHostDeployment } from "./contract";
import { pushS3StaticComponentKindErrors } from "./s3-static-capability-validation";
import { prepareS3StaticPublisherConfig } from "./s3-static-config";
import { pushVercelComponentKindErrors } from "./vercel-capability-validation";
import { prepareVercelPublisherConfig } from "./vercel-config";
import { appTargetBoundaryErrors } from "./deployment-boundary-checks";
import { ambientProviderEnvBypassErrors } from "./external-deployment-requirements";
import { protectedDeploymentPlaceholderErrors } from "./deployment-placeholder-validation";
import { readOpenTofuResolvedPlan } from "./opentofu-stack";
import { packagePathFromLabel } from "../lib/labels";

function componentsForValidation(deployment: DeploymentTarget): DeploymentComponent[] {
  return deployment.components.length > 0
    ? deployment.components
    : [{ id: "default", kind: deployment.component.kind, target: deployment.component.target }];
}

async function validationNodeMap(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<Map<string, GraphNode>> {
  const labels = Array.from(
    new Set(
      [
        deployment.label,
        ...componentsForValidation(deployment).map((component) => component.target),
      ]
        .map((label) => String(label || "").trim())
        .filter(Boolean),
    ),
  );
  const nodes = await queryDeploymentNodesWithAttrs(workspaceRoot, labels, [
    ...DEPLOYMENT_CQUERY_ATTRS,
    "deps",
  ]);
  return new Map(nodes.map((node) => [node.name, node]));
}

function pushNixosSharedHostComponentErrors(opts: {
  deployment: NixosSharedHostDeployment;
  nodeMap: Map<string, GraphNode>;
  errors: string[];
}) {
  for (const component of componentsForValidation(opts.deployment)) {
    const componentNode = opts.nodeMap.get(component.target);
    if (!isSupportedComponentNode(component.kind, componentNode)) {
      opts.errors.push(
        `${opts.deployment.label}: component target ${component.target} is not a supported ${component.kind}`,
      );
    }
  }
}

function pushComponentValidationErrors(opts: {
  deployment: DeploymentTarget;
  nodeMap: Map<string, GraphNode>;
  errors: string[];
}) {
  for (const component of componentsForValidation(opts.deployment)) {
    const componentNode = opts.nodeMap.get(component.target);
    switch (opts.deployment.provider) {
      case "cloudflare-pages":
        pushCloudflareComponentKindErrors({
          label: opts.deployment.label,
          declaredKind: component.kind,
          componentTarget: component.target,
          componentNode,
          errors: opts.errors,
        });
        break;
      case "s3-static":
        pushS3StaticComponentKindErrors({
          label: opts.deployment.label,
          declaredKind: component.kind,
          componentTarget: component.target,
          componentNode,
          errors: opts.errors,
        });
        break;
      case "kubernetes":
        pushKubernetesComponentKindErrors({
          label: opts.deployment.label,
          declaredKind: component.kind,
          componentTarget: component.target,
          componentNode,
          errors: opts.errors,
        });
        break;
      case "app-store-connect":
        pushAppStoreConnectComponentKindErrors({
          label: opts.deployment.label,
          declaredKind: component.kind,
          componentTarget: component.target,
          componentNode,
          errors: opts.errors,
        });
        break;
      case "google-play":
        pushGooglePlayComponentKindErrors({
          label: opts.deployment.label,
          declaredKind: component.kind,
          componentTarget: component.target,
          componentNode,
          errors: opts.errors,
        });
        break;
      case "nixos-shared-host":
        break;
      case "vercel":
        pushVercelComponentKindErrors({
          label: opts.deployment.label,
          declaredKind: component.kind,
          componentTarget: component.target,
          componentNode,
          errors: opts.errors,
        });
        break;
      case "opentofu":
        if (!isSupportedComponentNode(component.kind, componentNode)) {
          opts.errors.push(
            `${opts.deployment.label}: component target ${component.target} is not a supported ${component.kind}`,
          );
        }
        break;
      default:
        opts.errors.push(`${opts.deployment.label}: unsupported deployment provider`);
    }
  }
  if (opts.deployment.provider === "nixos-shared-host") {
    pushNixosSharedHostComponentErrors({
      deployment: opts.deployment,
      nodeMap: opts.nodeMap,
      errors: opts.errors,
    });
  }
}

async function validateProviderConfigSemantics(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<void> {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "deploy-validate-"));
  const outputPath = path.join(tmpRoot, "provider-config.json");
  try {
    switch (deployment.provider) {
      case "cloudflare-pages":
        await prepareCloudflarePagesWranglerConfig({ workspaceRoot, deployment, outputPath });
        return;
      case "s3-static":
        await prepareS3StaticPublisherConfig({ workspaceRoot, deployment, outputPath });
        return;
      case "kubernetes":
        await prepareKubernetesPublisherConfig({
          workspaceRoot,
          deployment,
          componentArtifacts: Object.fromEntries(
            componentsForValidation(deployment).map((component) => [
              component.id,
              { path: `/validation/${component.id}`, identity: `validation:${component.id}` },
            ]),
          ),
          outputPath,
        });
        return;
      case "app-store-connect":
        await prepareAppStoreConnectPublisherConfig({ workspaceRoot, deployment, outputPath });
        return;
      case "google-play":
        await prepareGooglePlayPublisherConfig({ workspaceRoot, deployment, outputPath });
        return;
      case "nixos-shared-host":
        return;
      case "vercel":
        await prepareVercelPublisherConfig({ workspaceRoot, deployment, outputPath });
        return;
      case "opentofu":
        await readOpenTofuResolvedPlan({
          workspaceRoot,
          packagePath: packagePathFromLabel(deployment.label),
          provisioner: deployment.provisioner,
        });
        return;
    }
  } finally {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  }
}

export async function validateRepoFrontDoorDeployment(
  workspaceRoot: string,
  deployment: DeploymentTarget,
): Promise<void> {
  const nodeMap = await validationNodeMap(workspaceRoot, deployment);
  const errors: string[] = [];
  if (!nodeMap.has(deployment.label)) {
    errors.push(`deployment target not found: ${deployment.label}`);
  }
  errors.push(...appTargetBoundaryErrors(Array.from(nodeMap.values())));
  errors.push(
    ...ambientProviderEnvBypassErrors({
      label: deployment.label,
      env: process.env,
      secretRequirements: deployment.secretRequirements,
      profiles: deployment.externalRequirementProfiles || [],
    }),
  );
  errors.push(...protectedDeploymentPlaceholderErrors(deployment));
  pushComponentValidationErrors({ deployment, nodeMap, errors });
  if (errors.length > 0) {
    throw new Error(Array.from(new Set(errors)).join("\n"));
  }
  await validateProviderConfigSemantics(workspaceRoot, deployment);
}
