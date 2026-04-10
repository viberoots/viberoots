#!/usr/bin/env zx-wrapper
import type { GraphNode } from "../lib/graph.ts";
import { deploymentError } from "./contract-extract-shared.ts";
import { isDeploymentComponentKind } from "./deployment-component-kinds.ts";
import { providerSupportsComponentKind } from "./deployment-provider-capabilities.ts";

export function pushGooglePlayComponentKindErrors(opts: {
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
  if (!providerSupportsComponentKind("google-play", opts.declaredKind)) {
    opts.errors.push(
      deploymentError(
        opts.label,
        `google-play provider capability does not support component_kind "${opts.declaredKind}"`,
      ),
    );
  }
  if (opts.componentTarget && !opts.componentNode) {
    opts.errors.push(
      deploymentError(opts.label, `component target ${opts.componentTarget} does not exist`),
    );
  }
}
