#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import type { DeploymentTarget } from "./contract";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function fingerprintValue(value: unknown): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

export function deploymentMetadataFingerprintFor(deployment: DeploymentTarget): string {
  return fingerprintValue(deployment);
}
