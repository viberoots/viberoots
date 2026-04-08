#!/usr/bin/env zx-wrapper
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostAdmittedArtifact } from "./nixos-shared-host-artifacts.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";
import { primaryNixosSharedHostComponent } from "./nixos-shared-host-components.ts";

export function normalizeSingleComponentArtifactInput(opts: {
  deployment: NixosSharedHostDeployment;
  artifact?: NixosSharedHostAdmittedArtifact;
  componentArtifacts?: NixosSharedHostResolvedComponentArtifact[];
}): NixosSharedHostAdmittedArtifact | undefined {
  if (opts.artifact && opts.componentArtifacts?.length) {
    throw new Error(
      "single-component nixos-shared-host submissions must not provide both exact and per-component artifact inputs",
    );
  }
  if (opts.artifact) return opts.artifact;
  if (!opts.componentArtifacts?.length) return undefined;
  const primaryComponentId = primaryNixosSharedHostComponent(opts.deployment).id;
  if (opts.componentArtifacts.length !== 1) {
    throw new Error(
      "single-component nixos-shared-host deployments accept exactly one per-component artifact input",
    );
  }
  const [resolvedArtifact] = opts.componentArtifacts;
  if (resolvedArtifact.componentId !== primaryComponentId) {
    throw new Error(
      `single-component nixos-shared-host artifact input must target primary component "${primaryComponentId}"`,
    );
  }
  return resolvedArtifact.artifact;
}
