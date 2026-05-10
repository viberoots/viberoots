#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import type { AppStoreConnectDeployment } from "../../deployments/contract";
import {
  installMobileSharedTargets,
  labelName,
  writePublisherConfig,
} from "./mobile-release.e2e.helpers";

export async function writeAppStoreConnectConfig(
  workspaceRoot: string,
  deployment: AppStoreConnectDeployment,
): Promise<void> {
  await writePublisherConfig(workspaceRoot, deployment.deploymentId, "app-store-connect.jsonc", {
    issuer: deployment.providerTarget.issuer,
    app: deployment.providerTarget.app,
    bundle_id: deployment.providerTarget.bundleId,
    track: deployment.providerTarget.track,
    signing_model: deployment.providerTarget.signingModel,
  });
}

export async function installAppStoreConnectTargets(
  workspaceRoot: string,
  deployments: AppStoreConnectDeployment[],
): Promise<void> {
  await installMobileSharedTargets({
    workspaceRoot,
    appTargetLabel: "//projects/apps/demo-ios:release",
    appArtifactName: "release.ipa",
    appArtifactMarker: "demo-ios",
    deployments,
  });
  await Promise.all(
    deployments.map(async (deployment) => {
      const deployTargetsPath = path.join(
        workspaceRoot,
        "projects",
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
          '    provider = "app-store-connect",',
          '    component = "//projects/apps/demo-ios:release",',
          '    component_kind = "mobile-app",',
          '    publisher = "app-store-connect-mobile-release",',
          '    publisher_config = "app-store-connect.jsonc",',
          `    protection_class = ${JSON.stringify(deployment.protectionClass)},`,
          `    lane_policy = ${JSON.stringify(deployment.lanePolicyRef)},`,
          `    environment_stage = ${JSON.stringify(deployment.environmentStage)},`,
          `    admission_policy = ${JSON.stringify(deployment.admissionPolicyRef)},`,
          '    components = [{"id": "default", "kind": "mobile-app", "target": "//projects/apps/demo-ios:release"}],',
          "    provider_target = {",
          `        "issuer": ${JSON.stringify(deployment.providerTarget.issuer)},`,
          `        "app": ${JSON.stringify(deployment.providerTarget.app)},`,
          `        "bundle_id": ${JSON.stringify(deployment.providerTarget.bundleId)},`,
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

export function appStoreConnectFakeEnv(tmp: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    VBR_APP_STORE_CONNECT_FAKE_STORE_ROOT: path.join(tmp, "fake-store"),
  };
}
