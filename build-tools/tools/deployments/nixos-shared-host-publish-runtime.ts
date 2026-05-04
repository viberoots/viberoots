#!/usr/bin/env zx-wrapper
import type {
  NixosSharedHostDeploymentComponent,
  NixosSharedHostSsrRuntimeContract,
} from "./contract";
import { hasNixosSharedHostSsrRuntimeContract } from "./contract";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts";
import {
  publishNixosSharedHostSsrWebapp,
  resolveNixosSharedHostSsrWebappLiveState,
} from "./nixos-shared-host-ssr-publisher";
import {
  publishNixosSharedHostStaticWebapp,
  resolveNixosSharedHostStaticWebappLiveState,
} from "./nixos-shared-host-static-publisher";
import type { NixosSharedHostConfig } from "./nixos-shared-host";
import { nixosSharedHostContainerRoot } from "./nixos-shared-host-runtime";

export type NixosSharedHostPublishedSmokeInput =
  | { kind: "static-webapp"; indexPath: string }
  | { kind: "ssr-webapp"; runtimeContract: NixosSharedHostSsrRuntimeContract };

export type NixosSharedHostPublishedRuntimeState = {
  releasePath: string;
  activatedPath: string;
  liveArtifactIdentity: string;
  smokeInput: NixosSharedHostPublishedSmokeInput;
};

function componentContainer(
  rendered: NixosSharedHostConfig,
  component: NixosSharedHostDeploymentComponent,
) {
  const containerName = component.providerTarget.containerName;
  if (!containerName) throw new Error(`component "${component.id}" is missing containerName`);
  const container = rendered.containers[containerName];
  if (!container) {
    throw new Error(
      `publish target is missing realized container for ${component.providerTarget.sharedDevTargetIdentity || component.id}`,
    );
  }
  return container;
}

export async function resolveNixosSharedHostLiveReuse(opts: {
  component: NixosSharedHostDeploymentComponent;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  artifact: NixosSharedHostResolvedComponentArtifact["artifact"];
}): Promise<NixosSharedHostPublishedRuntimeState | undefined> {
  const container = componentContainer(opts.rendered, opts.component);
  const containerRoot = nixosSharedHostContainerRoot(opts.hostRoot, container.containerName);
  if (hasNixosSharedHostSsrRuntimeContract(opts.component)) {
    const live = await resolveNixosSharedHostSsrWebappLiveState({
      containerRoot,
      layout: container,
      runtimeContract: opts.component.runtime.runtimeContract,
      artifactIdentity: opts.artifact.identity,
    });
    return live
      ? {
          releasePath: live.releasePath,
          activatedPath: live.activatedPath,
          liveArtifactIdentity: live.artifactIdentity,
          smokeInput: {
            kind: "ssr-webapp",
            runtimeContract: opts.component.runtime.runtimeContract,
          },
        }
      : undefined;
  }
  const live = await resolveNixosSharedHostStaticWebappLiveState({
    containerRoot,
    layout: container,
  });
  return live && live.artifactIdentity === opts.artifact.identity
    ? {
        releasePath: live.releasePath,
        activatedPath: live.activatedPath,
        liveArtifactIdentity: live.artifactIdentity,
        smokeInput: { kind: "static-webapp", indexPath: live.indexPath },
      }
    : undefined;
}

export async function publishNixosSharedHostComponentRuntime(opts: {
  component: NixosSharedHostDeploymentComponent;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  artifact: NixosSharedHostResolvedComponentArtifact["artifact"];
}): Promise<NixosSharedHostPublishedRuntimeState> {
  const container = componentContainer(opts.rendered, opts.component);
  const containerRoot = nixosSharedHostContainerRoot(opts.hostRoot, container.containerName);
  if (hasNixosSharedHostSsrRuntimeContract(opts.component)) {
    const published = await publishNixosSharedHostSsrWebapp({
      artifactDir: opts.artifact.storedArtifactPath,
      artifactIdentity: opts.artifact.identity,
      containerRoot,
      layout: container,
      runtimeContract: opts.component.runtime.runtimeContract,
    });
    return {
      releasePath: published.releasePath,
      activatedPath: published.activatedPath,
      liveArtifactIdentity: published.artifactIdentity,
      smokeInput: {
        kind: "ssr-webapp",
        runtimeContract: opts.component.runtime.runtimeContract,
      },
    };
  }
  const published = await publishNixosSharedHostStaticWebapp({
    artifactDir: opts.artifact.storedArtifactPath,
    artifactIdentity: opts.artifact.identity,
    containerRoot,
    layout: container,
  });
  return {
    releasePath: published.releasePath,
    activatedPath: published.activatedPath,
    liveArtifactIdentity: published.artifactIdentity,
    smokeInput: { kind: "static-webapp", indexPath: published.indexPath },
  };
}
