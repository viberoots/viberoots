#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { requireNixosSharedHostReplayComponentState } from "../../deployments/nixos-shared-host-replay.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

function multiComponentDeployment() {
  const frontendTarget = nixosSharedHostDeploymentFixture().components[0]!.providerTarget;
  return nixosSharedHostDeploymentFixture({
    components: [
      {
        id: "frontend",
        kind: "static-webapp",
        target: "//projects/apps/demoapp:app",
        runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
        providerTarget: frontendTarget,
      },
      {
        id: "api",
        kind: "static-webapp",
        target: "//projects/apps/demoapi:app",
        runtime: { appName: "demoapi", containerPort: 3001, healthPath: "/healthz" },
        providerTarget: {
          ...frontendTarget,
          appName: "demoapi",
          hostname: "demoapi.apps.kilty.io",
          containerName: "demoapi",
          deploymentTargetIdentity: "nixos-shared-host:default:demoapi",
          sharedDevTargetIdentity: "nixos-shared-host:default:demoapi",
          appNames: ["demoapi"],
        },
      },
    ],
    rolloutPolicy: {
      mode: "ordered_best_effort",
      abort: "stop_on_first_failure",
      smoke: "final_only",
      steps: ["frontend", "api"],
    },
  });
}

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
  assert.throws(
    () =>
      requireNixosSharedHostReplayComponentState(multiComponentDeployment(), {
        publishInput: {
          kind: "component-artifacts",
          compositeArtifactIdentity: "nixos-shared-host-release:123",
          components: componentArtifacts(),
        },
        componentResults: [
          {
            componentId: "frontend",
            providerTargetIdentity: "nixos-shared-host:default:demoapp",
            artifactIdentity: "static-webapp:frontend",
            finalOutcome: "succeeded",
          },
          {
            componentId: "api",
            providerTargetIdentity: "nixos-shared-host:default:demoapi",
            artifactIdentity: "static-webapp:wrong",
            finalOutcome: "succeeded",
          },
        ],
      } as any),
    /state drifted/,
  );
});
