#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { deploymentError } from "./contract-extract-shared";
import { isDeploymentComponentKind } from "./deployment-component-kinds";
import { providerSupportsComponentKind } from "./deployment-provider-capabilities";
import {
  isTargetExceptionActive,
  type DeploymentTargetException,
} from "./deployment-target-exceptions";

const SUPPORTED_INGRESS_MODES = new Set(["public", "private", "none"]);

export function pushCloudflareContainersComponentErrors(opts: {
  label: string;
  declaredKind: string;
  componentTarget?: string;
  componentNode?: GraphNode;
  errors: string[];
}) {
  if (!isDeploymentComponentKind(opts.declaredKind)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `unsupported deployment component_kind "${opts.declaredKind || "<empty>"}"`,
      ),
    );
    return;
  }
  if (!providerSupportsComponentKind("cloudflare-containers", opts.declaredKind)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `cloudflare-containers provider capability does not support component_kind "${opts.declaredKind}"`,
      ),
    );
  }
  if (opts.componentTarget && !opts.componentNode) {
    opts.errors.push(
      deploymentError(opts.label, `component target ${opts.componentTarget} does not exist`),
    );
  }
}

export function pushCloudflareContainersIngressErrors(opts: {
  label: string;
  deploymentId: string;
  providerTargetIdentity: string;
  protectionClass: string;
  ingressMode: string;
  domain: string;
  zoneId: string;
  workersDevException: boolean;
  targetExceptions: DeploymentTargetException[];
  errors: string[];
}) {
  if (!SUPPORTED_INGRESS_MODES.has(opts.ingressMode)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `unsupported cloudflare-containers ingress_mode "${opts.ingressMode || "<empty>"}"`,
      ),
    );
    return;
  }
  if (opts.ingressMode !== "public") return;
  if (opts.domain && !opts.zoneId) {
    opts.errors.push(deploymentError(opts.label, "cloudflare_zone_id is required with domain"));
  }
  if (opts.domain || opts.protectionClass === "local_only") return;
  if (opts.workersDevException) {
    if (opts.protectionClass === "production_facing") {
      opts.errors.push(
        deploymentError(
          opts.label,
          "production_facing cloudflare-containers deployments require a custom domain",
        ),
      );
      return;
    }
    const reviewedException = opts.targetExceptions.some(
      (exception) =>
        isTargetExceptionActive(exception) &&
        exception.affectedDeploymentIds.includes(opts.deploymentId) &&
        exception.oldProviderTargetIdentity === opts.providerTargetIdentity &&
        exception.sharedLockScope === opts.providerTargetIdentity,
    );
    if (reviewedException) return;
    opts.errors.push(
      deploymentError(
        opts.label,
        "workers_dev_exception requires an active reviewed target_exception for this non-production cloudflare-containers target",
      ),
    );
    return;
  }
  opts.errors.push(
    deploymentError(
      opts.label,
      "protected/shared public cloudflare-containers deployments require domain or reviewed workers_dev_exception",
    ),
  );
}
