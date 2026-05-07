#!/usr/bin/env zx-wrapper
import type { DeploymentPrerequisiteMode, DeploymentTarget } from "./contract-types";

export type Phase0ReleaseComponent = "foundation" | "worker" | "web" | "console";
export type Phase0ReleaseStage = "dev" | "staging" | "prod";

export type Phase0ReleaseMember = {
  deploymentId: string;
  component: Phase0ReleaseComponent;
  stage: Phase0ReleaseStage;
};

const COMPONENTS: Phase0ReleaseComponent[] = ["foundation", "worker", "web", "console"];
const STAGES: Phase0ReleaseStage[] = ["dev", "staging", "prod"];

export const PHASE0_ADD_ORDER = [...COMPONENTS];
export const PHASE0_REMOVE_ORDER = [...COMPONENTS].reverse();
const STAGE_REMOVE_ORDER = [...STAGES].reverse();

function isPhase0Stage(value: string): value is Phase0ReleaseStage {
  return (STAGES as string[]).includes(value);
}

export function parsePhase0ReleaseMember(deploymentId: string): Phase0ReleaseMember | undefined {
  const match = deploymentId.match(
    /^((?:platform-foundation)|(?:data-room-worker)|(?:data-room-web)|(?:data-room-console))-(dev|staging|prod)$/,
  );
  if (!match || !isPhase0Stage(match[2])) return undefined;
  const componentByPrefix: Record<string, Phase0ReleaseComponent> = {
    "platform-foundation": "foundation",
    "data-room-worker": "worker",
    "data-room-web": "web",
    "data-room-console": "console",
  };
  return {
    deploymentId,
    component: componentByPrefix[match[1]],
    stage: match[2],
  };
}

function componentRank(component: Phase0ReleaseComponent, order: Phase0ReleaseComponent[]): number {
  return order.indexOf(component);
}

function stageRemoveRank(stage: Phase0ReleaseStage): number {
  return STAGE_REMOVE_ORDER.indexOf(stage);
}

export function orderPhase0DeploymentsForRemoval(
  deployments: DeploymentTarget[],
): DeploymentTarget[] {
  return [...deployments].sort((left, right) => {
    const leftMember = parsePhase0ReleaseMember(left.deploymentId);
    const rightMember = parsePhase0ReleaseMember(right.deploymentId);
    if (!leftMember && !rightMember) return 0;
    if (!leftMember) return 1;
    if (!rightMember) return -1;
    const componentDelta =
      componentRank(leftMember.component, PHASE0_REMOVE_ORDER) -
      componentRank(rightMember.component, PHASE0_REMOVE_ORDER);
    if (componentDelta !== 0) return componentDelta;
    const stageDelta = stageRemoveRank(leftMember.stage) - stageRemoveRank(rightMember.stage);
    if (stageDelta !== 0) return stageDelta;
    return left.label.localeCompare(right.label);
  });
}

function expectedComponentPrerequisite(member: Phase0ReleaseMember): string | undefined {
  const previous = COMPONENTS[COMPONENTS.indexOf(member.component) - 1];
  if (!previous) return undefined;
  const idByComponent: Record<Phase0ReleaseComponent, string> = {
    foundation: "platform-foundation",
    worker: "data-room-worker",
    web: "data-room-web",
    console: "data-room-console",
  };
  return `${idByComponent[previous]}-${member.stage}`;
}

function expectedStagePrerequisite(member: Phase0ReleaseMember): string | undefined {
  const previousStage = STAGES[STAGES.indexOf(member.stage) - 1];
  return previousStage
    ? member.deploymentId.replace(`-${member.stage}`, `-${previousStage}`)
    : undefined;
}

function hasPrerequisite(
  deployment: DeploymentTarget,
  deploymentId: string,
  mode: DeploymentPrerequisiteMode,
): boolean {
  return deployment.prerequisites.some(
    (prerequisite) => prerequisite.deploymentId === deploymentId && prerequisite.mode === mode,
  );
}

export function validatePhase0ReleasePrerequisites(deployments: DeploymentTarget[]): string[] {
  const byId = new Map(deployments.map((deployment) => [deployment.deploymentId, deployment]));
  const errors: string[] = [];
  for (const deployment of deployments) {
    const member = parsePhase0ReleaseMember(deployment.deploymentId);
    if (!member) continue;
    const componentPrerequisite = expectedComponentPrerequisite(member);
    if (
      componentPrerequisite &&
      byId.has(componentPrerequisite) &&
      !hasPrerequisite(deployment, componentPrerequisite, "health_gated")
    ) {
      errors.push(
        `${deployment.deploymentId} must health-gate ${componentPrerequisite} for Phase 0 add order`,
      );
    }
    const stagePrerequisite = expectedStagePrerequisite(member);
    if (
      stagePrerequisite &&
      byId.has(stagePrerequisite) &&
      !hasPrerequisite(deployment, stagePrerequisite, "ordering_only")
    ) {
      errors.push(
        `${deployment.deploymentId} must order after ${stagePrerequisite} for Phase 0 lane promotion`,
      );
    }
  }
  return errors;
}

function hasRuntimeConfig(deployment: DeploymentTarget, name: string): boolean {
  return deployment.runtimeConfigRequirements.some((requirement) => requirement.name === name);
}

function hasSmokeOrReleaseHealth(deployment: DeploymentTarget): boolean {
  return Boolean(deployment.smoke) || deployment.component.kind === "provision-only";
}

export function validatePhase0ReleaseContracts(deployments: DeploymentTarget[]): string[] {
  const errors: string[] = [];
  for (const deployment of deployments) {
    const member = parsePhase0ReleaseMember(deployment.deploymentId);
    if (!member) continue;
    if (!hasSmokeOrReleaseHealth(deployment)) {
      errors.push(`${deployment.deploymentId} must declare Phase 0 smoke or release-health checks`);
    }
    if (member.component === "foundation" && !deployment.migrationBundleRef) {
      errors.push(`${deployment.deploymentId} must attach migration evidence bundle metadata`);
    }
    if (member.component === "worker" && !hasRuntimeConfig(deployment, "job-queue-name")) {
      errors.push(`${deployment.deploymentId} must declare worker job compatibility config`);
    }
    if (member.component === "web" && !hasRuntimeConfig(deployment, "web-public-url")) {
      errors.push(`${deployment.deploymentId} must declare web API readiness config`);
    }
    if (member.component === "console" && !hasRuntimeConfig(deployment, "data-room-web-base-url")) {
      errors.push(`${deployment.deploymentId} must declare console-to-web base URL config`);
    }
  }
  return errors;
}

export * from "./deployment-phase0-admission";
