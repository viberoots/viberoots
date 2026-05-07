#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";

export const STATIC_WEBAPP_COMPONENT_KIND = "static-webapp";
export const SSR_WEBAPP_COMPONENT_KIND = "ssr-webapp";
export const MOBILE_APP_COMPONENT_KIND = "mobile-app";
export const SERVICE_COMPONENT_KIND = "service";
export const THIRD_PARTY_SERVICE_COMPONENT_KIND = "third-party-service";
export const PROVISION_ONLY_COMPONENT_KIND = "provision-only";

export type DeploymentComponentKind =
  | typeof STATIC_WEBAPP_COMPONENT_KIND
  | typeof SSR_WEBAPP_COMPONENT_KIND
  | typeof MOBILE_APP_COMPONENT_KIND
  | typeof SERVICE_COMPONENT_KIND
  | typeof THIRD_PARTY_SERVICE_COMPONENT_KIND
  | typeof PROVISION_ONLY_COMPONENT_KIND;

export type DeploymentDefaultSmokeClass =
  | "http_5m"
  | "http_10m"
  | "release_health"
  | "service_health_10m";

const COMPONENT_KIND_INFO: Record<
  DeploymentComponentKind,
  { defaultSmokeClass: DeploymentDefaultSmokeClass; requiresRuntimeContract: boolean }
> = {
  "static-webapp": { defaultSmokeClass: "http_5m", requiresRuntimeContract: false },
  "ssr-webapp": { defaultSmokeClass: "http_10m", requiresRuntimeContract: true },
  "mobile-app": { defaultSmokeClass: "release_health", requiresRuntimeContract: false },
  service: { defaultSmokeClass: "service_health_10m", requiresRuntimeContract: false },
  "third-party-service": {
    defaultSmokeClass: "service_health_10m",
    requiresRuntimeContract: false,
  },
  "provision-only": { defaultSmokeClass: "service_health_10m", requiresRuntimeContract: false },
};

export const DEPLOYMENT_COMPONENT_KINDS = Object.keys(
  COMPONENT_KIND_INFO,
) as DeploymentComponentKind[];

export function isDeploymentComponentKind(value: string): value is DeploymentComponentKind {
  return value in COMPONENT_KIND_INFO;
}

export function defaultSmokeClassForComponentKind(
  kind: DeploymentComponentKind,
): DeploymentDefaultSmokeClass {
  return COMPONENT_KIND_INFO[kind].defaultSmokeClass;
}

export function componentKindRequiresRuntimeContract(kind: DeploymentComponentKind): boolean {
  return COMPONENT_KIND_INFO[kind].requiresRuntimeContract;
}

export function isSupportedComponentNode(
  kind: DeploymentComponentKind,
  node: GraphNode | undefined,
): boolean {
  const labels = new Set(Array.isArray(node?.labels) ? node.labels : []);
  if (kind === STATIC_WEBAPP_COMPONENT_KIND) {
    return labels.has("kind:app") && (labels.has("webapp:static") || labels.has("webapp:pwa"));
  }
  if (kind === SSR_WEBAPP_COMPONENT_KIND) {
    return labels.has("kind:app") && labels.has("webapp:ssr");
  }
  if (kind === PROVISION_ONLY_COMPONENT_KIND) {
    return labels.has("kind:migration-bundle") || labels.has("deployment-component:provision-only");
  }
  return !!node;
}

export function isStaticWebappNode(node: GraphNode | undefined): boolean {
  return isSupportedComponentNode(STATIC_WEBAPP_COMPONENT_KIND, node);
}
