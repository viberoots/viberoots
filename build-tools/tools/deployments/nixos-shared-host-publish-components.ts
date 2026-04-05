#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment, NixosSharedHostDeploymentComponent } from "./contract.ts";
import {
  orderedNixosSharedHostComponents,
  primaryNixosSharedHostComponent,
} from "./nixos-shared-host-components.ts";
import { nixosSharedHostContainerRoot } from "./nixos-shared-host-runtime.ts";
import { publishNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-publisher.ts";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke.ts";
import type { NixosSharedHostConfig } from "./nixos-shared-host.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import type { NixosSharedHostComponentResult } from "./nixos-shared-host-records.ts";

type PublishedComponent = {
  component: NixosSharedHostDeploymentComponent;
  artifactIdentity: string;
  indexPath: string;
};

function baseComponentResult(
  component: NixosSharedHostDeploymentComponent,
  artifactIdentity: string,
): NixosSharedHostComponentResult {
  return {
    componentId: component.id,
    providerTargetIdentity: component.providerTarget.sharedDevTargetIdentity || "",
    artifactIdentity,
    finalOutcome: "succeeded",
  };
}

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

export async function publishNixosSharedHostArtifacts(opts: {
  deployment: NixosSharedHostDeployment;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  componentArtifacts: NixosSharedHostResolvedComponentArtifact[];
}): Promise<PublishedComponent[]> {
  const artifactById = new Map(
    opts.componentArtifacts.map((componentArtifact) => [
      componentArtifact.componentId,
      componentArtifact.artifact,
    ]),
  );
  const published: PublishedComponent[] = [];
  const orderedComponents = orderedNixosSharedHostComponents(opts.deployment);
  for (const component of orderedComponents) {
    const artifact = artifactById.get(component.id);
    if (!artifact) throw new Error(`missing exact artifact for component "${component.id}"`);
    const container = componentContainer(opts.rendered, component);
    try {
      const publishedComponent = await publishNixosSharedHostStaticWebapp({
        artifactDir: artifact.storedArtifactPath,
        artifactIdentity: artifact.identity,
        containerRoot: nixosSharedHostContainerRoot(opts.hostRoot, container.containerName),
        layout: {
          releaseRoot: container.releaseRoot,
          publishRoot: container.publishRoot,
          activeReleaseLink: container.activeReleaseLink,
        },
      });
      published.push({
        component,
        artifactIdentity: publishedComponent.artifactIdentity,
        indexPath: publishedComponent.indexPath,
      });
    } catch (error) {
      const componentResults = published.map(({ component, artifactIdentity }) =>
        baseComponentResult(component, artifactIdentity),
      );
      componentResults.push({
        ...baseComponentResult(component, artifact.identity),
        finalOutcome: "publish_failed",
      });
      for (const remaining of orderedComponents.slice(published.length + 1)) {
        componentResults.push({
          componentId: remaining.id,
          providerTargetIdentity: remaining.providerTarget.sharedDevTargetIdentity || "",
          finalOutcome: "not_started",
        });
      }
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        failedStep: "publish" as const,
        componentResults,
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
  for (const { component, artifactIdentity, indexPath } of opts.published) {
    try {
      const smoke = await smokeNixosSharedHostStaticWebapp({
        hostname: component.providerTarget.hostname || "",
        indexPath,
        healthPath: component.runtime.healthPath,
        connectOverride: opts.smokeConnectOverride,
      });
      componentResults.push({
        ...baseComponentResult(component, artifactIdentity),
        publicUrl: smoke.publicUrl,
        ...(smoke.healthUrl ? { healthUrl: smoke.healthUrl } : {}),
      });
    } catch (error) {
      if (singleComponent) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
          failedStep: "smoke" as const,
          componentResults: [
            {
              ...baseComponentResult(component, artifactIdentity),
              finalOutcome: "smoke_failed_after_publish",
            },
          ],
        });
      }
      componentResults.push({
        ...baseComponentResult(component, artifactIdentity),
        finalOutcome: "smoke_failed_after_publish",
      });
      for (const remaining of opts.published.slice(componentResults.length)) {
        componentResults.push(baseComponentResult(remaining.component, remaining.artifactIdentity));
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

export async function publishNixosSharedHostDeploymentComponents(opts: {
  deployment: NixosSharedHostDeployment;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  componentArtifacts: NixosSharedHostResolvedComponentArtifact[];
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}) {
  const published = await publishNixosSharedHostArtifacts(opts);
  return await smokeNixosSharedHostPublishedComponents({
    deployment: opts.deployment,
    published,
    ...(opts.smokeConnectOverride ? { smokeConnectOverride: opts.smokeConnectOverride } : {}),
  });
}
