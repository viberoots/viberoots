#!/usr/bin/env zx-wrapper
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostDeploymentComponent } from "./contract.ts";
import {
  baseNixosSharedHostComponentResult,
  withNixosSharedHostPublishState,
  type NixosSharedHostComponentResult,
} from "./nixos-shared-host-component-results.ts";
import { nixosSharedHostContainerRoot } from "./nixos-shared-host-runtime.ts";
import {
  publishNixosSharedHostStaticWebapp,
  resolveNixosSharedHostStaticWebappLiveState,
} from "./nixos-shared-host-static-publisher.ts";
import type { NixosSharedHostConfig } from "./nixos-shared-host.ts";

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
  priorResult?: NixosSharedHostComponentResult;
  allowLiveComponentReuse: boolean;
}) {
  const container = renderedContainer(opts.rendered, opts.component);
  if (!container) throw new Error(`missing realized container for ${opts.component.id}`);
  if (
    opts.allowLiveComponentReuse &&
    opts.priorResult?.publishState?.finalOutcome === "succeeded"
  ) {
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
