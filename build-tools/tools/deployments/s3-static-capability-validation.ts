#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import { deploymentError } from "./contract-extract-shared.ts";
import { STATIC_WEBAPP_COMPONENT } from "./contract-types.ts";
import { isDeploymentComponentKind, isStaticWebappNode } from "./deployment-component-kinds.ts";
import { providerSupportsComponentKind } from "./deployment-provider-capabilities.ts";

export function pushS3StaticComponentKindErrors(opts: {
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
  if (!providerSupportsComponentKind("s3-static", opts.declaredKind)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `s3-static provider capability does not support component_kind "${opts.declaredKind}"`,
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
