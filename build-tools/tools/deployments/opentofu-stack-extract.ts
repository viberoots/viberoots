#!/usr/bin/env zx-wrapper
import { packagePathFromLabel } from "../lib/labels.ts";
import { deploymentError } from "./contract-extract-shared.ts";
import { OPENTOFU_STACK_PROVISIONER, type OpenTofuProvisionerMetadata } from "./opentofu-stack.ts";

export const REVIEWED_STACK_PROVISIONERS = new Set([
  "terraform-stack",
  "cdktf-stack",
  OPENTOFU_STACK_PROVISIONER,
]);

export function readOpenTofuProvisionerMetadata(opts: {
  label: string;
  provisioner: string;
  provisionerConfig: string;
  providerTarget: Record<string, string>;
  errors: string[];
}): OpenTofuProvisionerMetadata | undefined {
  if (opts.provisioner !== OPENTOFU_STACK_PROVISIONER) return undefined;
  const stackIdentity = opts.providerTarget.stack_identity || "";
  const stateBackendIdentity = opts.providerTarget.state_backend_identity || "";
  const stackDirectory = "opentofu";
  if (!opts.provisionerConfig.startsWith(`${stackDirectory}/`)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `opentofu-stack provisioner_config must stay under ${packagePathFromLabel(opts.label)}/opentofu/`,
      ),
    );
  }
  if (!stackIdentity) {
    opts.errors.push(deploymentError(opts.label, "provider_target.stack_identity is required"));
  }
  if (!stateBackendIdentity) {
    opts.errors.push(
      deploymentError(opts.label, "provider_target.state_backend_identity is required"),
    );
  }
  return {
    type: OPENTOFU_STACK_PROVISIONER,
    config: opts.provisionerConfig,
    stackDirectory,
    stackIdentity,
    stateBackendIdentity,
    allowedEnvironmentDifferences: (opts.providerTarget.allowed_environment_differences || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  };
}
