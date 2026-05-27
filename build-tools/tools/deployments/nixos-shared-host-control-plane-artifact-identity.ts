#!/usr/bin/env zx-wrapper
import type { DeploymentExpectedArtifactIdentities } from "./deployment-artifact-binding";
import { DeploymentAdmissionError } from "./deployment-control-plane-errors";
import type { NixosSharedHostControlPlaneSnapshot } from "./nixos-shared-host-control-plane-contract";

export function assertExpectedArtifactIdentities(
  snapshot: NixosSharedHostControlPlaneSnapshot,
  expected: DeploymentExpectedArtifactIdentities,
) {
  const publishInput = snapshot.action.kind === "deploy" ? snapshot.action.publishInput : undefined;
  if (!publishInput) return;
  if (publishInput.kind === "exact-artifact" && expected.expectedArtifactIdentity) {
    if (publishInput.artifact.identity !== expected.expectedArtifactIdentity) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        "admitted artifact identity does not match the challenged expected identity",
      );
    }
  }
  if (publishInput.kind !== "component-artifacts") return;
  if (
    expected.expectedCompositeArtifactIdentity &&
    publishInput.compositeArtifactIdentity !== expected.expectedCompositeArtifactIdentity
  ) {
    throw new DeploymentAdmissionError(
      "no_longer_admitted",
      "admitted composite artifact identity does not match the challenged expected identity",
    );
  }
  for (const component of publishInput.components) {
    const expectedIdentity = expected.expectedComponentArtifactIdentities?.[component.componentId];
    if (expectedIdentity && component.artifact.identity !== expectedIdentity) {
      throw new DeploymentAdmissionError(
        "no_longer_admitted",
        `admitted artifact identity does not match challenged component ${component.componentId}`,
      );
    }
  }
}
