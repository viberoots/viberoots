#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { GooglePlayDeployment } from "../../deployments/contract.ts";
import {
  installMobileSharedTargets,
  labelDir,
  labelName,
  renderRolloutPolicyLines,
  writePublisherConfig,
} from "./mobile-release.e2e.helpers.ts";

export async function writeGooglePlayConfig(
  workspaceRoot: string,
  deployment: GooglePlayDeployment,
): Promise<void> {
  await writePublisherConfig(workspaceRoot, deployment.deploymentId, "google-play.jsonc", {
    developer_account: deployment.providerTarget.developerAccount,
    app: deployment.providerTarget.app,
    package_name: deployment.providerTarget.packageName,
    track: deployment.providerTarget.track,
    signing_model: deployment.providerTarget.signingModel,
  });
}

export async function installGooglePlayTargets(
  workspaceRoot: string,
  deployments: GooglePlayDeployment[],
): Promise<void> {
  await installMobileSharedTargets({
    workspaceRoot,
    appTargetLabel: "//test-workspace/apps/demo-android:release",
    appArtifactName: "release.aab",
    appArtifactMarker: "demo-android",
    deployments,
  });
  await Promise.all(
    deployments.map(async (deployment) => {
      const deployTargetsPath = path.join(
        workspaceRoot,
        "test-workspace",
        "deployments",
        deployment.deploymentId,
        "TARGETS",
      );
      await fsp.mkdir(path.dirname(deployTargetsPath), { recursive: true });
      await fsp.writeFile(
        deployTargetsPath,
        [
          'load("//build-tools/deployments:defs.bzl", "deployment_target")',
          "",
          "deployment_target(",
          `    name = ${JSON.stringify(labelName(deployment.label))},`,
          '    provider = "google-play",',
          '    component = "//test-workspace/apps/demo-android:release",',
          '    component_kind = "mobile-app",',
          '    publisher = "google-play-mobile-release",',
          '    publisher_config = "google-play.jsonc",',
          `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
          `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
          `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
          `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
          '    components = [{"id": "default", "kind": "mobile-app", "target": "//test-workspace/apps/demo-android:release"}],',
          ...renderRolloutPolicyLines(deployment.rolloutPolicy),
          "    provider_target = {",
          `        "developer_account": ${JSON.stringify(deployment.providerTarget.developerAccount)},`,
          `        "app": ${JSON.stringify(deployment.providerTarget.app)},`,
          `        "package_name": ${JSON.stringify(deployment.providerTarget.packageName)},`,
          `        "platform": ${JSON.stringify(deployment.providerTarget.platform)},`,
          `        "track": ${JSON.stringify(deployment.providerTarget.track)},`,
          `        "signing_model": ${JSON.stringify(deployment.providerTarget.signingModel)},`,
          "    },",
          ")",
          "",
        ].join("\n"),
        "utf8",
      );
    }),
  );
}

export function googlePlayFakeEnv(tmp: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BNX_GOOGLE_PLAY_FAKE_STORE_ROOT: path.join(tmp, "fake-store"),
  };
}
