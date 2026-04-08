#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment, NixosSharedHostDeploymentComponent } from "./contract.ts";
import {
  baseNixosSharedHostComponentResult,
  buildNixosSharedHostPublishFailureResults,
  withNixosSharedHostPublishState,
  withNixosSharedHostSmokeState,
  type NixosSharedHostComponentResult,
} from "./nixos-shared-host-component-results.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import {
  orderedNixosSharedHostComponents,
  primaryNixosSharedHostComponent,
} from "./nixos-shared-host-components.ts";
import { nixosSharedHostContainerRoot } from "./nixos-shared-host-runtime.ts";
import {
  publishNixosSharedHostStaticWebapp,
  resolveNixosSharedHostStaticWebappLiveState,
} from "./nixos-shared-host-static-publisher.ts";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke.ts";
import type { NixosSharedHostConfig } from "./nixos-shared-host.ts";

type PublishedComponent = {
  component: NixosSharedHostDeploymentComponent;
  result: NixosSharedHostComponentResult;
  indexPath: string;
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

async function maybeReusePublishedComponent(opts: {
  component: NixosSharedHostDeploymentComponent;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  artifact: NixosSharedHostResolvedComponentArtifact["artifact"];
  priorResult?: NixosSharedHostComponentResult;
  allowLiveComponentReuse: boolean;
}): Promise<PublishedComponent | undefined> {
  if (!opts.allowLiveComponentReuse) return undefined;
  if (opts.priorResult?.publishState?.finalOutcome !== "succeeded") return undefined;
  const container = componentContainer(opts.rendered, opts.component);
  const live = await resolveNixosSharedHostStaticWebappLiveState({
    containerRoot: nixosSharedHostContainerRoot(opts.hostRoot, container.containerName),
    layout: {
      releaseRoot: container.releaseRoot,
      publishRoot: container.publishRoot,
      activeReleaseLink: container.activeReleaseLink,
    },
  });
  if (!live || live.artifactIdentity !== opts.artifact.identity) return undefined;
  return {
    component: opts.component,
    result: withNixosSharedHostPublishState(
      baseNixosSharedHostComponentResult(opts.component, opts.artifact),
      {
        finalOutcome: "succeeded",
        mode: "reused_live_identity",
        releasePath: live.releasePath,
        activatedPath: live.activatedPath,
        liveArtifactIdentity: live.artifactIdentity,
      },
    ),
    indexPath: live.indexPath,
  };
}

async function publishOneComponent(opts: {
  component: NixosSharedHostDeploymentComponent;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  artifact: NixosSharedHostResolvedComponentArtifact["artifact"];
}) {
  const container = componentContainer(opts.rendered, opts.component);
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
  return {
    component: opts.component,
    result: withNixosSharedHostPublishState(
      baseNixosSharedHostComponentResult(opts.component, opts.artifact),
      {
        finalOutcome: "succeeded",
        mode: "published",
        releasePath: published.releasePath,
        activatedPath: published.activatedPath,
        liveArtifactIdentity: published.artifactIdentity,
      },
    ),
    indexPath: published.indexPath,
  } satisfies PublishedComponent;
}

export async function publishNixosSharedHostArtifacts(opts: {
  deployment: NixosSharedHostDeployment;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  componentArtifacts: NixosSharedHostResolvedComponentArtifact[];
  sourceComponentResults?: NixosSharedHostComponentResult[];
  allowLiveComponentReuse?: boolean;
}): Promise<PublishedComponent[]> {
  const artifactById = new Map(
    opts.componentArtifacts.map((componentArtifact) => [
      componentArtifact.componentId,
      componentArtifact.artifact,
    ]),
  );
  const priorResultById = new Map(
    (opts.sourceComponentResults || []).map((result) => [result.componentId, result]),
  );
  const published: PublishedComponent[] = [];
  const orderedComponents = orderedNixosSharedHostComponents(opts.deployment);
  for (const component of orderedComponents) {
    const artifact = artifactById.get(component.id);
    if (!artifact) throw new Error(`missing exact artifact for component "${component.id}"`);
    try {
      const reused = await maybeReusePublishedComponent({
        component,
        rendered: opts.rendered,
        hostRoot: opts.hostRoot,
        artifact,
        priorResult: priorResultById.get(component.id),
        allowLiveComponentReuse: !!opts.allowLiveComponentReuse,
      });
      published.push(
        reused ||
          (await publishOneComponent({
            component,
            rendered: opts.rendered,
            hostRoot: opts.hostRoot,
            artifact,
          })),
      );
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        failedStep: "publish" as const,
        componentResults: buildNixosSharedHostPublishFailureResults({
          published: published.map(({ result }) => result),
          failedComponent: component,
          failedArtifact: artifact,
          remainingComponents: orderedComponents.slice(published.length + 1),
          artifactById: artifactById as Map<
            string,
            NixosSharedHostResolvedComponentArtifact["artifact"]
          >,
        }),
      });
    }
  }
  return published;
}

export async function smokeNixosSharedHostPublishedComponents(opts: {
  deployment: NixosSharedHostDeployment;
  published: PublishedComponent[];
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{
  componentResults: NixosSharedHostComponentResult[];
  publicUrl?: string;
  healthUrl?: string;
}> {
  const primaryComponent = primaryNixosSharedHostComponent(opts.deployment);
  const singleComponent = opts.published.length === 1;
  const componentResults: NixosSharedHostComponentResult[] = [];
  for (const { component, result, indexPath } of opts.published) {
    try {
      const smoke = await smokeNixosSharedHostStaticWebapp({
        hostname: component.providerTarget.hostname || "",
        indexPath,
        healthPath: component.runtime.healthPath,
        connectOverride: opts.smokeConnectOverride,
      });
      componentResults.push(
        withNixosSharedHostSmokeState(result, {
          finalOutcome: "succeeded",
          publicUrl: smoke.publicUrl,
          ...(smoke.healthUrl ? { healthUrl: smoke.healthUrl } : {}),
        }),
      );
    } catch (error) {
      if (singleComponent) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          failedStep: "smoke" as const,
          componentResults: [
            withNixosSharedHostSmokeState(result, {
              finalOutcome: "smoke_failed_after_publish",
            }),
          ],
        });
      }
      componentResults.push(
        withNixosSharedHostSmokeState(result, {
          finalOutcome: "smoke_failed_after_publish",
        }),
      );
      for (const remaining of opts.published.slice(componentResults.length)) {
        componentResults.push(
          withNixosSharedHostSmokeState(remaining.result, {
            finalOutcome: "not_run",
          }),
        );
      }
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        failedStep: "smoke" as const,
        componentResults,
      });
    }
  }
  const primaryResult = componentResults.find(
    (result) => result.componentId === primaryComponent.id,
  );
  return {
    componentResults,
    ...(primaryResult?.publicUrl ? { publicUrl: primaryResult.publicUrl } : {}),
    ...(primaryResult?.healthUrl ? { healthUrl: primaryResult.healthUrl } : {}),
  };
}
