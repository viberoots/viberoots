#!/usr/bin/env zx-wrapper
import path from "node:path";
import { nixosSharedHostContainerRoot } from "../../deployments/nixos-shared-host-runtime.ts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture.ts";

export function progressiveFixture() {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "demo-stack-dev",
    label: "//projects/deployments/demo-stack-dev:deploy",
    components: [
      {
        id: "frontend",
        kind: "static-webapp",
        target: "//projects/apps/demoapp:app",
        runtime: { appName: "demoapp", containerPort: 3000, healthPath: "/healthz" },
        providerTarget: {
          host: "nixos-shared-host",
          targetGroup: "default",
          appNames: ["demoapp"],
          deploymentTargetIdentity: "nixos-shared-host:default:demoapp",
          appName: "demoapp",
          hostname: "demoapp.apps.kilty.io",
          containerName: "demoapp",
          sharedDevTargetIdentity: "nixos-shared-host:default:demoapp",
        },
      },
      {
        id: "api",
        kind: "static-webapp",
        target: "//projects/apps/demoapi:app",
        runtime: { appName: "demoapi", containerPort: 3001, healthPath: "/healthz" },
        providerTarget: {
          host: "nixos-shared-host",
          targetGroup: "default",
          appNames: ["demoapi"],
          deploymentTargetIdentity: "nixos-shared-host:default:demoapi",
          appName: "demoapi",
          hostname: "demoapi.apps.kilty.io",
          containerName: "demoapi",
          sharedDevTargetIdentity: "nixos-shared-host:default:demoapi",
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

export function progressiveHosts(hostRoot: string) {
  return {
    "demoapp.apps.kilty.io": () =>
      path.join(nixosSharedHostContainerRoot(hostRoot, "demoapp"), "srv/static-app/live"),
    "demoapi.apps.kilty.io": () =>
      path.join(nixosSharedHostContainerRoot(hostRoot, "demoapi"), "srv/static-app/live"),
  };
}

export function pauseOnFinalSmoke() {
  return {
    hooks: {
      gateEvaluator: ({ phaseId, outcome, defaultDecision }: any) =>
        phaseId === "smoke:final" && outcome === "succeeded" ? "pause" : defaultDecision,
    },
  };
}
