#!/usr/bin/env zx-wrapper
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-component-results.ts";
import type { NixosSharedHostDeployment } from "./contract.ts";

export type NixosSharedHostProgressivePhaseState =
  | "pending"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "aborted";

export type NixosSharedHostProgressiveGateType = "publish_complete" | "smoke_result";
export type NixosSharedHostProgressiveGateDecision = "proceed" | "pause" | "fail" | "abort";

export type NixosSharedHostProgressivePhase = {
  phaseId: string;
  kind: "publish" | "smoke";
  componentId?: string;
  state: NixosSharedHostProgressivePhaseState;
  gate: {
    type: NixosSharedHostProgressiveGateType;
    decision?: NixosSharedHostProgressiveGateDecision;
    evaluatedAt?: string;
    evidence?: Record<string, string | boolean>;
  };
};

export type NixosSharedHostProgressiveRollout = {
  mode: "ordered_best_effort";
  state: NixosSharedHostProgressivePhaseState;
  resumable: boolean;
  currentPhaseId?: string;
  supersedencePolicy: "reject_newer_runs_while_active";
  componentResults: NixosSharedHostComponentResult[];
  phases: NixosSharedHostProgressivePhase[];
};

export function createNixosSharedHostProgressiveRollout(
  deployment: NixosSharedHostDeployment,
): NixosSharedHostProgressiveRollout | undefined {
  if (
    deployment.components.length < 2 ||
    deployment.rolloutPolicy?.mode !== "ordered_best_effort"
  ) {
    return undefined;
  }
  return {
    mode: "ordered_best_effort",
    state: "pending",
    resumable: false,
    supersedencePolicy: "reject_newer_runs_while_active",
    componentResults: [],
    phases: [
      ...deployment.rolloutPolicy.steps.map((componentId) => ({
        phaseId: `publish:${componentId}`,
        kind: "publish" as const,
        componentId,
        state: "pending" as const,
        gate: { type: "publish_complete" as const },
      })),
      {
        phaseId: "smoke:final",
        kind: "smoke" as const,
        state: "pending" as const,
        gate: { type: "smoke_result" as const },
      },
    ],
  };
}

export function progressiveRolloutIsActive(rollout?: NixosSharedHostProgressiveRollout): boolean {
  return !!rollout && ["pending", "running", "paused"].includes(rollout.state);
}

export function updateProgressiveRolloutPhase(
  rollout: NixosSharedHostProgressiveRollout,
  phaseId: string,
  update: Partial<NixosSharedHostProgressivePhase>,
): NixosSharedHostProgressiveRollout {
  const phases = rollout.phases.map((phase) =>
    phase.phaseId === phaseId
      ? {
          ...phase,
          ...update,
          gate: update.gate ? { ...phase.gate, ...update.gate } : phase.gate,
        }
      : phase,
  );
  const current = phases.find((phase) => phase.phaseId === phaseId);
  return {
    ...rollout,
    phases,
    currentPhaseId:
      current?.state === "running" || current?.state === "paused" ? phaseId : undefined,
  };
}

export function summarizeProgressiveRolloutState(
  rollout: NixosSharedHostProgressiveRollout,
): NixosSharedHostProgressivePhaseState {
  if (rollout.phases.some((phase) => phase.state === "failed")) return "failed";
  if (rollout.phases.some((phase) => phase.state === "aborted")) return "aborted";
  if (rollout.phases.some((phase) => phase.state === "paused")) return "paused";
  if (rollout.phases.every((phase) => phase.state === "succeeded")) return "succeeded";
  if (rollout.phases.some((phase) => phase.state === "running")) return "running";
  return "pending";
}

export function withProgressiveRolloutState(
  rollout: NixosSharedHostProgressiveRollout,
  updates: Partial<Omit<NixosSharedHostProgressiveRollout, "phases">>,
): NixosSharedHostProgressiveRollout {
  const next = { ...rollout, ...updates };
  return { ...next, state: updates.state || summarizeProgressiveRolloutState(next) };
}
