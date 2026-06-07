#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";

export type DeploymentContextSecretRef = {
  provider: string;
  field: string;
  ref: string;
  route: "bootstrap" | "secret_backend";
};

export type DeploymentContextMetadata = {
  name: string;
  controlPlane?: {
    name: string;
    serviceClient: {
      controlPlaneUrl: string;
      controlPlaneTokenRef: string;
    };
    records: { backend: "service" };
  };
  localOverrides?: { path: string; sharedValue: unknown; localValue: unknown }[];
  secretRefs?: DeploymentContextSecretRef[];
};

export function readDeploymentContextMetadata(
  node: GraphNode,
): DeploymentContextMetadata | undefined {
  const raw = node.deployment_context_metadata;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const name = stringValue(record.name);
  if (!name) return undefined;
  const localOverrides = Array.isArray(record.localOverrides)
    ? (record.localOverrides as DeploymentContextMetadata["localOverrides"])
    : undefined;
  const secretRefs = Array.isArray(record.secretRefs)
    ? (record.secretRefs as DeploymentContextSecretRef[])
    : undefined;
  const controlPlane = readControlPlane(record.controlPlane);
  return {
    name,
    ...(controlPlane ? { controlPlane } : {}),
    ...(localOverrides?.length ? { localOverrides } : {}),
    ...(secretRefs?.length ? { secretRefs } : {}),
  };
}

function readControlPlane(value: unknown): DeploymentContextMetadata["controlPlane"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as DeploymentContextMetadata["controlPlane"];
  if (
    !record?.name ||
    !record.serviceClient?.controlPlaneUrl ||
    !record.serviceClient?.controlPlaneTokenRef
  ) {
    return undefined;
  }
  return record;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
