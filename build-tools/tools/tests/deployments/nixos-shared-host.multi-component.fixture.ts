#!/usr/bin/env zx-wrapper
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";

export function multiComponentDeployment(
  environmentStage: "dev" | "staging" = "dev",
  namePrefix = "demo",
) {
  const admissionPolicy =
    environmentStage === "staging"
      ? nixosSharedHostAdmissionPolicyFixture({
          ref: `//projects/deployments/${namePrefix}-shared:staging_release`,
          name: "staging_release",
          allowedRefs: ["env/pleomino/staging"],
          requiredChecks: [],
          fingerprint: `sha256:admission-${namePrefix}-staging`,
        })
      : nixosSharedHostAdmissionPolicyFixture({
          allowedRefs: ["env/pleomino/dev"],
          requiredChecks: [],
          fingerprint: `sha256:admission-${namePrefix}-dev`,
        });
  return nixosSharedHostDeploymentFixture({
    deploymentId: `${namePrefix}-stack-${environmentStage}`,
    label: `//projects/deployments/${namePrefix}-stack-${environmentStage}:deploy`,
    environmentStage,
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    components: [
      {
        id: "frontend",
        kind: "static-webapp",
        target: "//projects/apps/demoapp:app",
        runtime: {
          appName: `${namePrefix}-frontend-${environmentStage}`,
          containerPort: 3000,
          healthPath: "/healthz",
        },
        providerTarget: {
          host: "nixos-shared-host",
          targetGroup: "default",
          appNames: [`${namePrefix}-frontend-${environmentStage}`],
          deploymentTargetIdentity: `nixos-shared-host:default:${namePrefix}-frontend-${environmentStage}`,
          appName: `${namePrefix}-frontend-${environmentStage}`,
          hostname: `${namePrefix}-frontend-${environmentStage}.apps.kilty.io`,
          containerName: `${namePrefix}-frontend-${environmentStage}`,
          sharedDevTargetIdentity: `nixos-shared-host:default:${namePrefix}-frontend-${environmentStage}`,
        },
      },
      {
        id: "api",
        kind: "static-webapp",
        target: "//projects/apps/demoapi:app",
        runtime: {
          appName: `${namePrefix}-api-${environmentStage}`,
          containerPort: 3001,
          healthPath: "/healthz",
        },
        providerTarget: {
          host: "nixos-shared-host",
          targetGroup: "default",
          appNames: [`${namePrefix}-api-${environmentStage}`],
          deploymentTargetIdentity: `nixos-shared-host:default:${namePrefix}-api-${environmentStage}`,
          appName: `${namePrefix}-api-${environmentStage}`,
          hostname: `${namePrefix}-api-${environmentStage}.apps.kilty.io`,
          containerName: `${namePrefix}-api-${environmentStage}`,
          sharedDevTargetIdentity: `nixos-shared-host:default:${namePrefix}-api-${environmentStage}`,
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
