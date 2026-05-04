#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph";
import { deploymentError } from "./contract-extract-shared";
import { isDeploymentComponentKind } from "./deployment-component-kinds";
import { providerSupportsComponentKind } from "./deployment-provider-capabilities";

export function pushAppStoreConnectComponentKindErrors(opts: {
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
  if (!providerSupportsComponentKind("app-store-connect", opts.declaredKind)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `app-store-connect provider capability does not support component_kind "${opts.declaredKind}"`,
      ),
    );
  }
  if (opts.componentTarget && !opts.componentNode) {
    opts.errors.push(
      deploymentError(opts.label, `component target ${opts.componentTarget} does not exist`),
    );
  }
}
