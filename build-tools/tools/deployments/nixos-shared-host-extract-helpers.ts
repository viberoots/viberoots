#!/usr/bin/env zx-wrapper
import type { RawStaticWebappComponent } from "./contract-extract-components.ts";
import { componentError } from "./contract-extract-components.ts";
import type { DeploymentExtractionContext } from "./contract-extract-shared.ts";
import {
  deriveNixosSharedHostProviderTarget,
  STATIC_WEBAPP_COMPONENT,
  type NixosSharedHostDeploymentComponent,
} from "./contract-types.ts";
import { isStaticWebappNode } from "./deployment-component-kinds.ts";
import type { DeploymentReleaseAction } from "./deployment-release-actions.ts";
import {
  providerDeclaresReleaseActionType,
  providerSupportsComponentKind,
} from "./deployment-provider-capabilities.ts";
import { missingRequirementNames, type DeploymentRequirement } from "./deployment-requirements.ts";

const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TARGET_GROUP_RE = APP_NAME_RE;

export function resolveNixosSharedHostComponents(opts: {
  context: Pick<DeploymentExtractionContext, "components">;
  label: string;
  rawComponents: RawStaticWebappComponent[];
  errors: string[];
}): NixosSharedHostDeploymentComponent[] {
  const seenIds = new Set<string>();
  const resolvedComponents: NixosSharedHostDeploymentComponent[] = [];
  for (const rawComponent of opts.rawComponents) {
    if (!rawComponent.id) {
      opts.errors.push(`${opts.label}: components must set id`);
    }
    if (seenIds.has(rawComponent.id)) {
      opts.errors.push(componentError(opts.label, rawComponent.id, "duplicate component id"));
    }
    seenIds.add(rawComponent.id);
    if (!providerSupportsComponentKind("nixos-shared-host", rawComponent.kind)) {
      opts.errors.push(
        componentError(
          opts.label,
          rawComponent.id,
          `nixos-shared-host provider capability does not support component_kind "${rawComponent.kind || "<empty>"}"`,
        ),
      );
      continue;
    }
    if (!rawComponent.target) {
      opts.errors.push(
        componentError(opts.label, rawComponent.id, "missing required component target"),
      );
    }
    if (!rawComponent.appName) {
      opts.errors.push(componentError(opts.label, rawComponent.id, "missing required app_name"));
    }
    if (
      !Number.isInteger(rawComponent.containerPort) ||
      rawComponent.containerPort < 1 ||
      rawComponent.containerPort > 65535
    ) {
      opts.errors.push(
        componentError(
          opts.label,
          rawComponent.id,
          "container_port must be an integer between 1 and 65535",
        ),
      );
    }
    if (rawComponent.appName && !APP_NAME_RE.test(rawComponent.appName)) {
      opts.errors.push(
        componentError(
          opts.label,
          rawComponent.id,
          "app_name must be a lowercase hostname token without dots or subdomain overrides",
        ),
      );
    }
    if (rawComponent.targetGroup && !TARGET_GROUP_RE.test(rawComponent.targetGroup)) {
      opts.errors.push(
        componentError(
          opts.label,
          rawComponent.id,
          "target_group must be lowercase alphanumeric plus internal hyphens",
        ),
      );
    }
    if (rawComponent.healthPath && !rawComponent.healthPath.startsWith("/")) {
      opts.errors.push(
        componentError(
          opts.label,
          rawComponent.id,
          "health_path must start with '/' when provided",
        ),
      );
    }
    const componentNode = opts.context.components.get(rawComponent.target);
    if (rawComponent.target && !isStaticWebappNode(componentNode)) {
      opts.errors.push(
        componentError(
          opts.label,
          rawComponent.id,
          `component target ${rawComponent.target} is not a supported static-webapp`,
        ),
      );
    }
    resolvedComponents.push({
      id: rawComponent.id,
      kind: STATIC_WEBAPP_COMPONENT,
      target: rawComponent.target,
      runtime: {
        appName: rawComponent.appName,
        containerPort: rawComponent.containerPort,
        ...(rawComponent.healthPath ? { healthPath: rawComponent.healthPath } : {}),
        ...(rawComponent.targetGroup ? { targetGroup: rawComponent.targetGroup } : {}),
      },
      providerTarget: deriveNixosSharedHostProviderTarget({
        appName: rawComponent.appName,
        targetGroup: rawComponent.targetGroup,
      }),
    });
  }
  return resolvedComponents;
}

export function pushNixosSharedHostReleaseActionErrors(opts: {
  label: string;
  releaseActions: DeploymentReleaseAction[];
  secretRequirements: DeploymentRequirement[];
  runtimeConfigRequirements: DeploymentRequirement[];
  errors: string[];
}) {
  for (const action of opts.releaseActions) {
    if (!providerDeclaresReleaseActionType("nixos-shared-host", action.type)) {
      opts.errors.push(
        `${opts.label}: unsupported nixos-shared-host release_action type "${action.type}"`,
      );
    }
    for (const requirementName of missingRequirementNames(
      opts.secretRequirements,
      action.requiredSecretRequirementNames,
    )) {
      opts.errors.push(
        `${opts.label}: release_action ${action.ref} requires undeclared secret requirement "${requirementName}"`,
      );
    }
    for (const requirementName of missingRequirementNames(
      opts.runtimeConfigRequirements,
      action.requiredRuntimeConfigRequirementNames,
    )) {
      opts.errors.push(
        `${opts.label}: release_action ${action.ref} requires undeclared runtime_config requirement "${requirementName}"`,
      );
    }
  }
}
