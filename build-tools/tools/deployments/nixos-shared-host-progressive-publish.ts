#!/usr/bin/env zx-wrapper
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts";
import type { NixosSharedHostDeploymentComponent } from "./contract";
import {
  baseNixosSharedHostComponentResult,
  withNixosSharedHostPublishState,
} from "./nixos-shared-host-component-results";
import { nixosSharedHostContainerRoot } from "./nixos-shared-host-runtime";
import {
  publishNixosSharedHostStaticWebapp,
  resolveNixosSharedHostStaticWebappLiveState,
} from "./nixos-shared-host-static-publisher";
import type { NixosSharedHostConfig } from "./nixos-shared-host";

function renderedContainer(
  rendered: NixosSharedHostConfig,
  component: NixosSharedHostDeploymentComponent,
) {
  return rendered.containers[component.providerTarget.containerName || ""];
}

export async function publishComponent(opts: {
  component: NixosSharedHostDeploymentComponent;
  artifact: NixosSharedHostResolvedComponentArtifact["artifact"];
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  allowLiveComponentReuse: boolean;
}) {
  const container = renderedContainer(opts.rendered, opts.component);
  if (!container) throw new Error(`missing realized container for ${opts.component.id}`);
  if (opts.allowLiveComponentReuse) {
    const live = await resolveNixosSharedHostStaticWebappLiveState({
      containerRoot: nixosSharedHostContainerRoot(opts.hostRoot, container.containerName),
      layout: {
        releaseRoot: container.releaseRoot,
        publishRoot: container.publishRoot,
        activeReleaseLink: container.activeReleaseLink,
      },
    });
    if (live && live.artifactIdentity === opts.artifact.identity) {
      return withNixosSharedHostPublishState(
        baseNixosSharedHostComponentResult(opts.component, opts.artifact),
        {
          finalOutcome: "succeeded",
          mode: "reused_live_identity",
          releasePath: live.releasePath,
          activatedPath: live.activatedPath,
          liveArtifactIdentity: live.artifactIdentity,
        },
      );
    }
  }
  const published = await publishNixosSharedHostStaticWebapp({
    artifactDir: opts.artifact.storedArtifactPath,
    artifactIdentity: opts.artifact.identity,
    containerRoot: nixosSharedHostContainerRoot(opts.hostRoot, container.containerName),
    layout: {
      releaseRoot: container.releaseRoot,
      publishRoot: container.publishRoot,
      activeReleaseLink: container.activeReleaseLink,
    },
  });
  return withNixosSharedHostPublishState(
    baseNixosSharedHostComponentResult(opts.component, opts.artifact),
    {
      finalOutcome: "succeeded",
      mode: "published",
      releasePath: published.releasePath,
      activatedPath: published.activatedPath,
      liveArtifactIdentity: published.artifactIdentity,
    },
  );
}
