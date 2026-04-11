#!/usr/bin/env zx-wrapper
import type { DeploymentTarget } from "./contract.ts";

function appStoreTrackRank(track: string): number {
  return (
    {
      "testflight-internal": 0,
      "testflight-external": 1,
      "app-store": 2,
    }[track] ?? -1
  );
}

export function rolloutSignature(deployment: DeploymentTarget): string {
  return JSON.stringify(deployment.rolloutPolicy || null);
}

export function mobilePromotionCompatibilityErrors(
  deployment: DeploymentTarget,
  sourceDeployment: DeploymentTarget,
): string[] {
  if (deployment.provider !== sourceDeployment.provider) return [];
  if (!["app-store-connect", "google-play"].includes(deployment.provider)) return [];
  const errors: string[] = [];
  if (deployment.providerTarget.signingModel !== sourceDeployment.providerTarget.signingModel) {
    errors.push(
      `signing model mismatch: current=${deployment.providerTarget.signingModel} source=${sourceDeployment.providerTarget.signingModel}`,
    );
  }
  const trackRank = (track: string) =>
    deployment.provider === "google-play"
      ? ({ internal: 0, alpha: 1, beta: 2, production: 3 }[track] ?? -1)
      : appStoreTrackRank(track);
  const sourceTrackRank = trackRank(sourceDeployment.providerTarget.track);
  const targetTrackRank = trackRank(deployment.providerTarget.track);
  if (sourceTrackRank < 0 || targetTrackRank < 0 || targetTrackRank < sourceTrackRank) {
    errors.push(
      `mobile track progression mismatch: current=${deployment.providerTarget.track} source=${sourceDeployment.providerTarget.track}`,
    );
  }
  const rolloutRank = (mode: string) =>
    mode === "store_staged" ? 1 : mode === "all_at_once" ? 0 : -1;
  const sourceRollout = sourceDeployment.rolloutPolicy?.mode || "all_at_once";
  const targetRollout = deployment.rolloutPolicy?.mode || "all_at_once";
  if (rolloutRank(sourceRollout) < 0 || rolloutRank(targetRollout) < rolloutRank(sourceRollout)) {
    errors.push(
      `mobile rollout progression mismatch: current=${targetRollout} source=${sourceRollout}`,
    );
  }
  return errors;
}

function joinedComponentField(
  deployment: DeploymentTarget,
  project: (component: DeploymentTarget["components"][number]) => string,
): string {
  return deployment.components.map(project).sort().join(",");
}

export function componentIds(deployment: DeploymentTarget): string {
  return joinedComponentField(deployment, (component) => component.id);
}

export function componentKinds(deployment: DeploymentTarget): string {
  return joinedComponentField(deployment, (component) => component.kind);
}

export function componentTargets(deployment: DeploymentTarget): string {
  return joinedComponentField(deployment, (component) => component.target);
}

export function componentRuntimeContracts(deployment: DeploymentTarget): string {
  if (deployment.provider !== "nixos-shared-host") return "";
  return deployment.components
    .filter((component) => "runtimeContract" in component.runtime)
    .map((component) =>
      JSON.stringify({
        id: component.id,
        kind: component.kind,
        runtimeContract: component.runtime.runtimeContract,
      }),
    )
    .sort()
    .join(",");
}

export function provisionerTypeFor(deployment: DeploymentTarget): string {
  return "provisioner" in deployment ? deployment.provisioner?.type || "" : "";
}

export function promotionCompatibilityFamily(deployment: DeploymentTarget): string {
  const kinds = Array.from(
    new Set(deployment.components.map((component) => component.kind)),
  ).sort();
  if (kinds.length !== 1) return "";
  if (kinds[0] === "static-webapp") return "static-webapp:exact-environment-neutral-v1";
  if (kinds[0] === "ssr-webapp" && deployment.provider === "nixos-shared-host") {
    return `ssr-webapp:${componentRuntimeContracts(deployment)}`;
  }
  if (kinds[0] === "mobile-app" && deployment.provider === "app-store-connect") {
    return "mobile-app:ios-store-bundle-v1";
  }
  if (kinds[0] === "mobile-app" && deployment.provider === "google-play") {
    return "mobile-app:android-store-bundle-v1";
  }
  if (kinds[0] === "service" && deployment.provider === "kubernetes") {
    return "service:kubernetes-runtime-v1";
  }
  if (kinds[0] === "third-party-service" && deployment.provider === "kubernetes") {
    return "third-party-service:kubernetes-runtime-v1";
  }
  return "";
}
