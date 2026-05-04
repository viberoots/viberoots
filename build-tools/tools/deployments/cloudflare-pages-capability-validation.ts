#!/usr/bin/env zx-wrapper
import { STATIC_WEBAPP_COMPONENT } from "./contract-types";
import { isDeploymentComponentKind, isStaticWebappNode } from "./deployment-component-kinds";
import { providerSupportsComponentKind } from "./deployment-provider-capabilities";
import { deploymentError } from "./contract-extract-shared";
import type { GraphNode } from "../lib/graph";

export function pushCloudflareComponentKindErrors(opts: {
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
  if (!providerSupportsComponentKind("cloudflare-pages", opts.declaredKind)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `cloudflare-pages provider capability does not support component_kind "${opts.declaredKind}"`,
      ),
    );
  }
  if (
    opts.declaredKind === STATIC_WEBAPP_COMPONENT &&
    opts.componentTarget &&
    !isStaticWebappNode(opts.componentNode)
  ) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `component target ${opts.componentTarget} is not a supported static-webapp`,
      ),
    );
  }
}
