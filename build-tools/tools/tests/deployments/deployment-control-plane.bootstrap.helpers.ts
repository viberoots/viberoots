#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  admitNixosSharedHostComponentArtifacts,
  compositeNixosSharedHostArtifactIdentity,
} from "../../deployments/nixos-shared-host-component-artifacts";
import { nixosSharedHostDeploymentFixture } from "./nixos-shared-host.fixture";

export async function writeBootstrapArtifact(root: string, body: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), `<html>${body}</html>\n`, "utf8");
  await fsp.writeFile(path.join(root, "healthz"), "ok\n", "utf8");
}

export function bootstrapCasePaths(root: string) {
  return {
    statePath: path.join(root, "platform-state.json"),
    hostRoot: path.join(root, "host"),
    recordsRoot: path.join(root, "records"),
  };
}

export function bootstrapDeploymentFixture() {
  return nixosSharedHostDeploymentFixture({
    deploymentId: "deploy-system-dev",
    label: "//projects/deployments/deploy-system-dev:deploy",
    runtime: {
      ...nixosSharedHostDeploymentFixture().runtime,
      appName: "deploy-system",
    },
    bootstrap: {
      scope: "deployment_authority",
      modes: ["first_install", "offline_recovery"],
    },
  });
}

export async function bootstrapArtifacts(
  tmp: string,
  deployment: ReturnType<typeof bootstrapDeploymentFixture>,
) {
  const artifactDir = path.join(tmp, "artifact");
  await writeBootstrapArtifact(artifactDir, "bootstrap");
  const componentArtifacts = await admitNixosSharedHostComponentArtifacts({
    deployment,
    recordsRoot: path.join(tmp, "records"),
    artifactDirsByComponentId: { default: artifactDir },
  });
  return {
    componentArtifacts,
    compositeArtifactIdentity: compositeNixosSharedHostArtifactIdentity(componentArtifacts),
  };
}
