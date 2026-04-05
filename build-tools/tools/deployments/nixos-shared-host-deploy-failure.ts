#!/usr/bin/env zx-wrapper
import type {
  NixosSharedHostFailedStep,
  NixosSharedHostFinalOutcome,
} from "./nixos-shared-host-records.ts";

const FAILED_STEPS = new Set<NixosSharedHostFailedStep>([
  "provision",
  "publish",
  "smoke",
  "release_actions.pre_publish",
  "release_actions.post_publish_pre_smoke",
  "release_actions.post_smoke",
]);

export function withFailedStep(
  step: NixosSharedHostFailedStep,
  error: unknown,
): Error & { failedStep: NixosSharedHostFailedStep } {
  const base = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { failedStep: step });
}

export function failedStepFromError(error: unknown): NixosSharedHostFailedStep {
  if (
    error &&
    typeof error === "object" &&
    "failedStep" in error &&
    typeof error.failedStep === "string" &&
    FAILED_STEPS.has(error.failedStep as NixosSharedHostFailedStep)
  ) {
    return error.failedStep as NixosSharedHostFailedStep;
  }
  return "provision";
}

export function finalOutcomeForFailedStep(
  failedStep: NixosSharedHostFailedStep,
): NixosSharedHostFinalOutcome {
  return failedStep === "smoke"
    ? "smoke_failed_after_publish"
    : failedStep === "publish"
      ? "publish_failed"
      : failedStep.startsWith("release_actions.")
        ? "release_action_failed"
        : "provision_failed";
}
