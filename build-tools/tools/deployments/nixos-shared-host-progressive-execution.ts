#!/usr/bin/env zx-wrapper
import path from "node:path";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts";
import type { NixosSharedHostDeployment, NixosSharedHostDeploymentComponent } from "./contract";
import {
  baseNixosSharedHostComponentResult,
  buildNixosSharedHostPublishFailureResults,
  withNixosSharedHostSmokeState,
  type NixosSharedHostComponentResult,
} from "./nixos-shared-host-component-results";
import { publishComponent } from "./nixos-shared-host-progressive-publish";
import {
  summarizeProgressiveRolloutState,
  updateProgressiveRolloutPhase,
  withProgressiveRolloutState,
  type NixosSharedHostProgressiveGateDecision,
  type NixosSharedHostProgressiveRollout,
} from "./nixos-shared-host-progressive-rollout";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke";
import type { NixosSharedHostConfig } from "./nixos-shared-host";

export type NixosSharedHostGateEvaluator = (opts: {
  phaseId: string;
  phaseKind: "publish" | "smoke";
  outcome: "succeeded" | "failed";
  defaultDecision: NixosSharedHostProgressiveGateDecision;
}) => NixosSharedHostProgressiveGateDecision | undefined;

export async function runNixosSharedHostProgressiveExecution(opts: {
  deployment: NixosSharedHostDeployment;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  published: NixosSharedHostComponentResult[];
  componentArtifacts: NixosSharedHostResolvedComponentArtifact[];
  rollout: NixosSharedHostProgressiveRollout;
  allowLiveComponentReuse: boolean;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
  gateEvaluator?: NixosSharedHostGateEvaluator;
}) {
  const artifactById = new Map(
    opts.componentArtifacts.map((entry) => [entry.componentId, entry.artifact]),
  );
  const orderedComponents = opts.deployment.components;
  const resultById = new Map(opts.published.map((entry) => [entry.componentId, entry]));
  let rollout = withProgressiveRolloutState(opts.rollout, {
    state: summarizeProgressiveRolloutState(opts.rollout),
  });
  for (const phase of rollout.phases) {
    if (phase.state === "succeeded" || phase.state === "aborted") continue;
    if (phase.state === "paused") {
      rollout = withProgressiveRolloutState(
        updateProgressiveRolloutPhase(rollout, phase.phaseId, {
          state: "succeeded",
          gate: {
            ...phase.gate,
            decision: "proceed",
            evaluatedAt: new Date().toISOString(),
          },
        }),
        { state: "running", resumable: false },
      );
      continue;
    }
    rollout = withProgressiveRolloutState(
      updateProgressiveRolloutPhase(rollout, phase.phaseId, { state: "running" }),
      { state: "running", resumable: false },
    );
    if (phase.kind === "publish") {
      const component = opts.deployment.components.find((entry) => entry.id === phase.componentId)!;
      const artifact = artifactById.get(component.id);
      if (!artifact) throw new Error(`missing exact artifact for component "${component.id}"`);
      try {
        const published = await publishComponent({
          component,
          artifact,
          rendered: opts.rendered,
          hostRoot: opts.hostRoot,
          priorResult: resultById.get(component.id),
          allowLiveComponentReuse: opts.allowLiveComponentReuse,
        });
        resultById.set(component.id, published);
        rollout = withProgressiveRolloutState(
          updateProgressiveRolloutPhase(rollout, phase.phaseId, {
            state: "succeeded",
            gate: {
              decision: "proceed",
              evaluatedAt: new Date().toISOString(),
              evidence: { componentId: component.id },
            },
          }),
          { componentResults: Array.from(resultById.values()) },
        );
      } catch (error) {
        const phaseResults = buildNixosSharedHostPublishFailureResults({
          published: Array.from(resultById.values()),
          failedComponent: component,
          failedArtifact: artifact,
          remainingComponents: orderedComponents.slice(orderedComponents.indexOf(component) + 1),
          artifactById,
        });
        rollout = withProgressiveRolloutState(
          updateProgressiveRolloutPhase(rollout, phase.phaseId, {
            state: "failed",
            gate: {
              decision: "fail",
              evaluatedAt: new Date().toISOString(),
              evidence: { error: String((error as Error).message || error) },
            },
          }),
          { state: "failed", resumable: false, componentResults: phaseResults },
        );
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          failedStep: "publish" as const,
          componentResults: phaseResults,
          progressiveRollout: rollout,
        });
      }
      continue;
    }
    const results = Array.from(resultById.values());
    try {
      for (const result of results) {
        const component = opts.deployment.components.find(
          (entry) => entry.id === result.componentId,
        )!;
        const smoke = await smokeNixosSharedHostStaticWebapp({
          hostname: component.providerTarget.hostname || "",
          indexPath: path.join(result.publishState?.releasePath || "", "index.html"),
          healthPath: component.runtime.healthPath,
          connectOverride: opts.smokeConnectOverride,
        });
        resultById.set(
          result.componentId,
          withNixosSharedHostSmokeState(result, {
            finalOutcome: "succeeded",
            publicUrl: smoke.publicUrl,
            ...(smoke.healthUrl ? { healthUrl: smoke.healthUrl } : {}),
          }),
        );
      }
      const decision =
        opts.gateEvaluator?.({
          phaseId: phase.phaseId,
          phaseKind: "smoke",
          outcome: "succeeded",
          defaultDecision: "proceed",
        }) || "proceed";
      if (decision === "pause") {
        rollout = withProgressiveRolloutState(
          updateProgressiveRolloutPhase(rollout, phase.phaseId, {
            state: "paused",
            gate: { decision, evaluatedAt: new Date().toISOString() },
          }),
          { state: "paused", resumable: true, componentResults: Array.from(resultById.values()) },
        );
        return { kind: "pause" as const, rollout };
      }
      rollout = withProgressiveRolloutState(
        updateProgressiveRolloutPhase(rollout, phase.phaseId, {
          state: "succeeded",
          gate: { decision: "proceed", evaluatedAt: new Date().toISOString() },
        }),
        { componentResults: Array.from(resultById.values()) },
      );
    } catch (error) {
      const decision =
        opts.gateEvaluator?.({
          phaseId: phase.phaseId,
          phaseKind: "smoke",
          outcome: "failed",
          defaultDecision: "fail",
        }) || "fail";
      rollout = withProgressiveRolloutState(
        updateProgressiveRolloutPhase(rollout, phase.phaseId, {
          state: decision === "pause" ? "paused" : decision === "abort" ? "aborted" : "failed",
          gate: {
            decision,
            evaluatedAt: new Date().toISOString(),
            evidence: { error: String((error as Error).message || error) },
          },
        }),
        {
          state: decision === "pause" ? "paused" : decision === "abort" ? "aborted" : "failed",
          resumable: decision === "pause",
          componentResults: Array.from(resultById.values()),
        },
      );
      if (decision === "pause" || decision === "abort") return { kind: decision, rollout };
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        failedStep: "smoke" as const,
        componentResults: Array.from(resultById.values()),
        progressiveRollout: rollout,
      });
    }
  }
  return {
    kind: "completed" as const,
    rollout: withProgressiveRolloutState(rollout, {
      state: "succeeded",
      resumable: false,
      componentResults: Array.from(resultById.values()),
    }),
    componentResults: Array.from(resultById.values()),
  };
}
