#!/usr/bin/env zx-wrapper
import { deploymentError } from "./contract-extract-shared";
import {
  readOpenTofuProvisionerMetadata,
  REVIEWED_STACK_PROVISIONERS,
} from "./opentofu-stack-extract";

export function readVercelProvisionerMetadata(opts: {
  label: string;
  provisioner: string;
  provisionerConfig: string;
  providerTarget: Record<string, string>;
  errors: string[];
}) {
  const openTofuProvisioner = readOpenTofuProvisionerMetadata(opts);
  if (opts.provisioner && !REVIEWED_STACK_PROVISIONERS.has(opts.provisioner)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `unsupported vercel provisioner "${opts.provisioner}" (expected terraform-stack, cdktf-stack, or opentofu-stack)`,
      ),
    );
  }
  if (opts.provisioner && !opts.provisionerConfig) {
    opts.errors.push(
      deploymentError(opts.label, "provisioner_config is required when provisioner is set"),
    );
  }
  if (!opts.provisioner && opts.provisionerConfig) {
    opts.errors.push(
      deploymentError(opts.label, "provisioner_config requires a reviewed provisioner"),
    );
  }
  return openTofuProvisioner;
}
