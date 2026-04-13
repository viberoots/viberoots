#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { requireNixosSharedHostReplayComponentState } from "../../deployments/nixos-shared-host-replay.ts";
import { multiComponentDeployment } from "./nixos-shared-host.multi-component.fixture.ts";

function componentArtifacts() {
  return [
    {
      componentId: "frontend",
      artifact: {
        kind: "static-webapp" as const,
        identity: "static-webapp:frontend",
        storedArtifactPath: "/tmp/frontend",
        provenancePath: "/tmp/frontend.json",
      },
    },
    {
      componentId: "api",
      artifact: {
        kind: "static-webapp" as const,
        identity: "static-webapp:api",
        storedArtifactPath: "/tmp/api",
        provenancePath: "/tmp/api.json",
      },
    },
  ];
}

test("nixos-shared-host multi-component replay requires recorded per-component replay state", () => {
  assert.throws(
    () =>
      requireNixosSharedHostReplayComponentState(multiComponentDeployment(), {
        publishInput: {
          kind: "component-artifacts",
          compositeArtifactIdentity: "nixos-shared-host-release:123",
          components: componentArtifacts(),
        },
      } as any),
    /missing recorded per-component replay state/,
  );
});

test("nixos-shared-host multi-component replay rejects per-component artifact drift", () => {
  const deployment = multiComponentDeployment();
  assert.throws(
    () =>
      requireNixosSharedHostReplayComponentState(deployment, {
        publishInput: {
          kind: "component-artifacts",
          compositeArtifactIdentity: "nixos-shared-host-release:123",
          components: componentArtifacts(),
        },
        componentResults: [
          {
            componentId: "frontend",
            providerTargetIdentity:
              deployment.components[0]!.providerTarget.deploymentTargetIdentity,
            artifactIdentity: "static-webapp:frontend",
            finalOutcome: "succeeded",
          },
          {
            componentId: "api",
            providerTargetIdentity:
              deployment.components[1]!.providerTarget.deploymentTargetIdentity,
            artifactIdentity: "static-webapp:wrong",
            finalOutcome: "succeeded",
          },
        ],
      } as any),
    /state drifted/,
  );
});
