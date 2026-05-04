#!/usr/bin/env zx-wrapper
import type { RawNixosSharedHostComponent } from "./contract-extract-components";
import { componentError } from "./contract-extract-components";
import type { DeploymentExtractionContext } from "./contract-extract-shared";
import {
  deriveNixosSharedHostProviderTarget,
  SSR_WEBAPP_COMPONENT,
  STATIC_WEBAPP_COMPONENT,
  type NixosSharedHostSsrRuntimeContract,
  type NixosSharedHostDeploymentComponent,
} from "./contract-types";
import { isSupportedComponentNode } from "./deployment-component-kinds";
import type { DeploymentReleaseAction } from "./deployment-release-actions";
import {
  providerDeclaresReleaseActionType,
  providerSupportsComponentKind,
} from "./deployment-provider-capabilities";
import { missingRequirementNames, type DeploymentRequirement } from "./deployment-requirements";
import type { NixosSharedHostDeployment } from "./contract";

const APP_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TARGET_GROUP_RE = APP_NAME_RE;
const SSR_FRAMEWORKS = new Set(["express", "next", "vite", "hatch"]);

function ssrRuntimeContractFor(
  rawComponent: RawNixosSharedHostComponent,
): NixosSharedHostSsrRuntimeContract | undefined {
  if (rawComponent.kind !== SSR_WEBAPP_COMPONENT) return undefined;
  return {
    type: "node-dist-server-v1",
    framework: rawComponent.ssrFramework as NixosSharedHostSsrRuntimeContract["framework"],
    serverEntry: "dist/server/index.js",
    clientDir: "dist/client",
    servingTopology: "single-host-node-with-nginx",
    environmentNeutralBuild: true,
    runtimeConfigInjection: "runtime_config_requirements",
    secretInjection: "secret_requirements",
  };
}

export function resolveNixosSharedHostComponents(opts: {
  context: Pick<DeploymentExtractionContext, "components">;
  label: string;
  rawComponents: RawNixosSharedHostComponent[];
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
    if (rawComponent.kind === SSR_WEBAPP_COMPONENT) {
      if (!SSR_FRAMEWORKS.has(rawComponent.ssrFramework)) {
        opts.errors.push(
          componentError(
            opts.label,
            rawComponent.id,
            `ssr_framework must be one of ${Array.from(SSR_FRAMEWORKS).join("|")}`,
          ),
        );
      }
      if (rawComponent.ssrRuntimeContract !== "node-dist-server-v1") {
        opts.errors.push(
          componentError(
            opts.label,
            rawComponent.id,
            `unsupported ssr_runtime_contract "${rawComponent.ssrRuntimeContract || "<empty>"}"`,
          ),
        );
      }
      if (rawComponent.ssrServerEntry !== "dist/server/index.js") {
        opts.errors.push(
          componentError(
            opts.label,
            rawComponent.id,
            "ssr_server_entry must be dist/server/index.js for the reviewed host slice",
          ),
        );
      }
      if (rawComponent.ssrClientDir !== "dist/client") {
        opts.errors.push(
          componentError(
            opts.label,
            rawComponent.id,
            "ssr_client_dir must be dist/client for the reviewed host slice",
          ),
        );
      }
      if (rawComponent.ssrServingTopology !== "single-host-node-with-nginx") {
        opts.errors.push(
          componentError(
            opts.label,
            rawComponent.id,
            `unsupported ssr_serving_topology "${rawComponent.ssrServingTopology || "<empty>"}"`,
          ),
        );
      }
      if (rawComponent.ssrEnvironmentNeutralBuild !== "true") {
        opts.errors.push(
          componentError(
            opts.label,
            rawComponent.id,
            "ssr_environment_neutral_build must be true for promotion-safe host SSR lanes",
          ),
        );
      }
    }
    const componentNode = opts.context.components.get(rawComponent.target);
    if (rawComponent.target && !isSupportedComponentNode(rawComponent.kind as any, componentNode)) {
      opts.errors.push(
        componentError(
          opts.label,
          rawComponent.id,
          `component target ${rawComponent.target} is not a supported ${rawComponent.kind || "deployment component"}`,
        ),
      );
    }
    const runtimeContract = ssrRuntimeContractFor(rawComponent);
    resolvedComponents.push({
      id: rawComponent.id,
      kind:
        rawComponent.kind === SSR_WEBAPP_COMPONENT ? SSR_WEBAPP_COMPONENT : STATIC_WEBAPP_COMPONENT,
      target: rawComponent.target,
      runtime: {
        appName: rawComponent.appName,
        containerPort: rawComponent.containerPort,
        ...(rawComponent.healthPath ? { healthPath: rawComponent.healthPath } : {}),
        ...(rawComponent.targetGroup ? { targetGroup: rawComponent.targetGroup } : {}),
        ...(runtimeContract ? { runtimeContract } : {}),
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

export function nixosSharedHostPromotionCompatibilityErrors(
  deployment: Pick<NixosSharedHostDeployment, "label" | "components">,
): string[] {
  const firstKind = deployment.components[0]?.kind || "";
  if (deployment.components.some((component) => component.kind !== firstKind)) {
    return [
      `${deployment.label}: nixos-shared-host deployments must not mix static-webapp and ssr-webapp components`,
    ];
  }
  if (firstKind === SSR_WEBAPP_COMPONENT && deployment.components.length > 1) {
    return [
      `${deployment.label}: reviewed nixos-shared-host ssr-webapp support is single-component only`,
    ];
  }
  return [];
}
