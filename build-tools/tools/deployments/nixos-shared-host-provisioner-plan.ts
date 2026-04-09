#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract.ts";
import {
  applyNixosSharedHostScopedDeployments,
  removeNixosSharedHostPlatformDeployment,
  type NixosSharedHostPlatformState,
} from "./nixos-shared-host-platform.ts";
import { readNixosSharedHostPlatformStateOrEmpty } from "./nixos-shared-host-io.ts";

export const NIXOS_SHARED_HOST_PROVISIONER_PLAN_SCHEMA = "nixos-shared-host-provisioner-plan@1";

export type NixosSharedHostProvisionerMutationClass = "non_destructive" | "destructive";

export type NixosSharedHostProvisionerPlanRef = {
  artifactPath: string;
  fingerprint: string;
  mutationClass: NixosSharedHostProvisionerMutationClass;
  destructiveReasons: string[];
};

export type NixosSharedHostProvisionerPlan = NixosSharedHostProvisionerPlanRef & {
  schemaVersion: typeof NIXOS_SHARED_HOST_PROVISIONER_PLAN_SCHEMA;
  submissionId: string;
  deploymentId: string;
  deploymentLabel: string;
  providerTargetIdentity: string;
  operationKind: NixosSharedHostControlPlaneSnapshot["operationKind"];
  currentStateFingerprint: string;
  plannedStateFingerprint: string;
  changedDeploymentIds: string[];
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function fingerprint(value: unknown): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex")}`;
}

function planPathFor(recordsRoot: string, submissionId: string): string {
  return path.join(
    path.resolve(recordsRoot),
    "control-plane",
    "provisioner-plans",
    `${submissionId}.json`,
  );
}

function componentSet(
  deployment?: NixosSharedHostPlatformState["deployments"][number],
): Set<string> {
  return new Set(
    (deployment?.components || []).flatMap((component) =>
      [component.providerTarget.hostname, component.providerTarget.sharedDevTargetIdentity].filter(
        Boolean,
      ),
    ),
  );
}

function destructiveReasonsFor(opts: {
  snapshot: NixosSharedHostControlPlaneSnapshot;
  current: NixosSharedHostPlatformState;
}): string[] {
  if (opts.snapshot.action.kind === "explicit_removal") {
    return [
      `explicit_removal deletes deployment "${opts.snapshot.deploymentId}" from platform state`,
    ];
  }
  const currentDeployment = opts.current.deployments.find(
    (deployment) => deployment.deploymentId === opts.snapshot.deploymentId,
  );
  if (!currentDeployment) return [];
  const nextComponents = componentSet(opts.snapshot.deployment);
  const currentComponents = componentSet(currentDeployment);
  const removed = [...currentComponents].filter((entry) => !nextComponents.has(entry)).sort();
  return removed.map(
    (entry) => `scoped apply would delete or replace live target identity "${entry}"`,
  );
}

function changedDeploymentIds(opts: {
  snapshot: NixosSharedHostControlPlaneSnapshot;
  current: NixosSharedHostPlatformState;
  planned: NixosSharedHostPlatformState;
}): string[] {
  const ids = new Set<string>([opts.snapshot.deploymentId]);
  for (const deployment of opts.current.deployments) ids.add(deployment.deploymentId);
  for (const deployment of opts.planned.deployments) ids.add(deployment.deploymentId);
  return [...ids]
    .filter((deploymentId) => {
      const current = opts.current.deployments.find((entry) => entry.deploymentId === deploymentId);
      const planned = opts.planned.deployments.find((entry) => entry.deploymentId === deploymentId);
      return (
        JSON.stringify(canonicalize(current || null)) !==
        JSON.stringify(canonicalize(planned || null))
      );
    })
    .sort();
}

function plannedStateFor(
  snapshot: NixosSharedHostControlPlaneSnapshot,
  current: NixosSharedHostPlatformState,
): NixosSharedHostPlatformState {
  if (snapshot.action.kind === "explicit_removal") {
    return removeNixosSharedHostPlatformDeployment(current, snapshot.deploymentId);
  }
  return applyNixosSharedHostScopedDeployments(current, [snapshot.deployment]);
}

export async function writeNixosSharedHostProvisionerPlan(opts: {
  snapshot: NixosSharedHostControlPlaneSnapshot;
}): Promise<NixosSharedHostProvisionerPlanRef | undefined> {
  if (
    opts.snapshot.action.kind === "deploy" &&
    opts.snapshot.action.publishBehavior === "publish-only"
  ) {
    return undefined;
  }
  const current = await readNixosSharedHostPlatformStateOrEmpty(opts.snapshot.paths.statePath);
  const planned = plannedStateFor(opts.snapshot, current);
  const destructiveReasons = destructiveReasonsFor({ snapshot: opts.snapshot, current });
  const artifactPath = planPathFor(opts.snapshot.paths.recordsRoot, opts.snapshot.submissionId);
  const plan: NixosSharedHostProvisionerPlan = {
    schemaVersion: NIXOS_SHARED_HOST_PROVISIONER_PLAN_SCHEMA,
    submissionId: opts.snapshot.submissionId,
    deploymentId: opts.snapshot.deploymentId,
    deploymentLabel: opts.snapshot.deploymentLabel,
    providerTargetIdentity: opts.snapshot.providerTargetIdentity,
    operationKind: opts.snapshot.operationKind,
    artifactPath,
    currentStateFingerprint: fingerprint(current),
    plannedStateFingerprint: fingerprint(planned),
    fingerprint: "",
    mutationClass: destructiveReasons.length > 0 ? "destructive" : "non_destructive",
    destructiveReasons,
    changedDeploymentIds: changedDeploymentIds({ snapshot: opts.snapshot, current, planned }),
  };
  const finalized = { ...plan, fingerprint: fingerprint({ ...plan, fingerprint: "" }) };
  await fsp.mkdir(path.dirname(artifactPath), { recursive: true });
  await fsp.writeFile(artifactPath, JSON.stringify(finalized, null, 2) + "\n", "utf8");
  return {
    artifactPath,
    fingerprint: finalized.fingerprint,
    mutationClass: finalized.mutationClass,
    destructiveReasons: finalized.destructiveReasons,
  };
}
