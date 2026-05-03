#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import { deploymentError } from "./contract-extract-shared.ts";
import { SSR_WEBAPP_COMPONENT } from "./contract-types.ts";
import {
  isDeploymentComponentKind,
  isSupportedComponentNode,
} from "./deployment-component-kinds.ts";
import { providerSupportsComponentKind } from "./deployment-provider-capabilities.ts";

export function pushVercelComponentKindErrors(opts: {
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
  if (!providerSupportsComponentKind("vercel", opts.declaredKind)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `vercel provider capability does not support component_kind "${opts.declaredKind}"`,
      ),
    );
  }
  if (
    opts.declaredKind === SSR_WEBAPP_COMPONENT &&
    opts.componentTarget &&
    !isSupportedComponentNode(SSR_WEBAPP_COMPONENT, opts.componentNode)
  ) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `component target ${opts.componentTarget} is not a supported ssr-webapp`,
      ),
    );
  }
}
