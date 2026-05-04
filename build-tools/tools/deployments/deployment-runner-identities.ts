#!/usr/bin/env zx-wrapper
import type {
  AppStoreConnectDeployment,
  CloudflarePagesDeployment,
  GooglePlayDeployment,
  KubernetesDeployment,
  S3StaticDeployment,
} from "./contract";

export type DeploymentRunnerIdentities = {
  publisher?: string;
  provisioner?: string;
  smoke?: string;
};

export function cloudflarePagesRunnerIdentities(
  deployment: CloudflarePagesDeployment,
): DeploymentRunnerIdentities {
  return {
    publisher: deployment.publisher.type,
    smoke: "cloudflare-pages-static-webapp-smoke@1",
  };
}

export function s3StaticRunnerIdentities(
  deployment: S3StaticDeployment,
): DeploymentRunnerIdentities {
  return {
    publisher: deployment.publisher.type,
    ...(deployment.provisioner ? { provisioner: deployment.provisioner.type } : {}),
    smoke: "s3-static-static-webapp-smoke@1",
  };
}

export function kubernetesRunnerIdentities(
  deployment: KubernetesDeployment,
): DeploymentRunnerIdentities {
  return {
    publisher: deployment.publisher.type,
    ...(deployment.provisioner ? { provisioner: deployment.provisioner.type } : {}),
    smoke: "kubernetes-release-smoke@1",
  };
}

export function appStoreConnectRunnerIdentities(
  deployment: AppStoreConnectDeployment,
): DeploymentRunnerIdentities {
  return {
    publisher: deployment.publisher.type,
    smoke: "app-store-connect-release-health@1",
  };
}

export function googlePlayRunnerIdentities(
  deployment: GooglePlayDeployment,
): DeploymentRunnerIdentities {
  return {
    publisher: deployment.publisher.type,
    smoke: "google-play-release-health@1",
  };
}

export function runnerIdentityCompatibilityErrors(
  expected: DeploymentRunnerIdentities,
  actual?: DeploymentRunnerIdentities,
): string[] {
  if (!actual) return ["stored runner identities are missing"];
  const errors: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof DeploymentRunnerIdentities>) {
    if (!expected[key]) continue;
    if (expected[key] !== actual[key]) {
      errors.push(
        `${key} runner identity mismatch: current=${expected[key]} source=${actual[key] || "<missing>"}`,
      );
    }
  }
  return errors;
}
