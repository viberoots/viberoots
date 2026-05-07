#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract-types";

const PLACEHOLDER_PATTERNS = [
  /replace-me/i,
  /placeholder/i,
  /\.example\.invalid/i,
  /^example[.:/-]/i,
];

function isPlaceholderString(value: string): boolean {
  const trimmed = value.trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function collectPlaceholderErrors(opts: {
  label: string;
  prefix: string;
  value: unknown;
  errors: string[];
}) {
  if (typeof opts.value === "string") {
    if (isPlaceholderString(opts.value)) {
      opts.errors.push(
        `${opts.label}: placeholder deployment value is unresolved: ${opts.prefix}=${opts.value}`,
      );
    }
    return;
  }
  if (Array.isArray(opts.value)) {
    opts.value.forEach((entry, index) =>
      collectPlaceholderErrors({
        ...opts,
        prefix: `${opts.prefix}[${index}]`,
        value: entry,
      }),
    );
    return;
  }
  if (!opts.value || typeof opts.value !== "object") return;
  for (const [key, entry] of Object.entries(opts.value as Record<string, unknown>)) {
    collectPlaceholderErrors({
      ...opts,
      prefix: opts.prefix ? `${opts.prefix}.${key}` : key,
      value: entry,
    });
  }
}

export function protectedDeploymentPlaceholderErrors(deployment: DeploymentTarget): string[] {
  if (deployment.protectionClass === "local_only") return [];
  const errors: string[] = [];
  collectPlaceholderErrors({
    label: deployment.label,
    prefix: "providerTarget",
    value: deployment.providerTarget,
    errors,
  });
  if ("provisioner" in deployment) {
    collectPlaceholderErrors({
      label: deployment.label,
      prefix: "provisioner",
      value: deployment.provisioner,
      errors,
    });
  }
  collectPlaceholderErrors({
    label: deployment.label,
    prefix: "vaultRuntime",
    value: deployment.vaultRuntime,
    errors,
  });
  collectPlaceholderErrors({
    label: deployment.label,
    prefix: "admissionPolicy.readinessGates",
    value: deployment.admissionPolicy.readinessGates || [],
    errors,
  });
  return Array.from(new Set(errors));
}
