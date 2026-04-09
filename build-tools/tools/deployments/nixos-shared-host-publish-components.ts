#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment, NixosSharedHostDeploymentComponent } from "./contract.ts";
import type { NixosSharedHostResolvedComponentArtifact } from "./nixos-shared-host-component-artifacts.ts";
import {
  baseNixosSharedHostComponentResult,
  buildNixosSharedHostPublishFailureResults,
  withNixosSharedHostPublishState,
  withNixosSharedHostSmokeState,
  type NixosSharedHostComponentResult,
} from "./nixos-shared-host-component-results.ts";
import {
  orderedNixosSharedHostComponents,
  primaryNixosSharedHostComponent,
} from "./nixos-shared-host-components.ts";
import {
  publishNixosSharedHostComponentRuntime,
  resolveNixosSharedHostLiveReuse,
  type NixosSharedHostPublishedSmokeInput,
} from "./nixos-shared-host-publish-runtime.ts";
import { smokeNixosSharedHostSsrWebapp } from "./nixos-shared-host-ssr-smoke.ts";
import { smokeNixosSharedHostStaticWebapp } from "./nixos-shared-host-static-smoke.ts";
import type { NixosSharedHostConfig } from "./nixos-shared-host.ts";

type PublishedComponent = {
  component: NixosSharedHostDeploymentComponent;
  result: NixosSharedHostComponentResult;
  smokeInput: NixosSharedHostPublishedSmokeInput;
};

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
  const live = await resolveNixosSharedHostLiveReuse(opts);
  if (!live) return undefined;
  return {
    component: opts.component,
    result: withNixosSharedHostPublishState(
      baseNixosSharedHostComponentResult(opts.component, opts.artifact),
      {
        finalOutcome: "succeeded",
        mode: "reused_live_identity",
        releasePath: live.releasePath,
        activatedPath: live.activatedPath,
        liveArtifactIdentity: live.liveArtifactIdentity,
      },
    ),
    smokeInput: live.smokeInput,
  };
}

async function publishOneComponent(opts: {
  component: NixosSharedHostDeploymentComponent;
  rendered: NixosSharedHostConfig;
  hostRoot: string;
  artifact: NixosSharedHostResolvedComponentArtifact["artifact"];
}): Promise<PublishedComponent> {
  const published = await publishNixosSharedHostComponentRuntime(opts);
  return {
    component: opts.component,
    result: withNixosSharedHostPublishState(
      baseNixosSharedHostComponentResult(opts.component, opts.artifact),
      {
        finalOutcome: "succeeded",
        mode: "published",
        releasePath: published.releasePath,
        activatedPath: published.activatedPath,
        liveArtifactIdentity: published.liveArtifactIdentity,
      },
    ),
    smokeInput: published.smokeInput,
  };
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
      published.push(
        (await maybeReusePublishedComponent({
          component,
          rendered: opts.rendered,
          hostRoot: opts.hostRoot,
          artifact,
          priorResult: priorResultById.get(component.id),
          allowLiveComponentReuse: !!opts.allowLiveComponentReuse,
        })) ||
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

async function smokePublishedComponent(opts: {
  component: NixosSharedHostDeploymentComponent;
  smokeInput: NixosSharedHostPublishedSmokeInput;
  connectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}) {
  return opts.smokeInput.kind === "ssr-webapp"
    ? await smokeNixosSharedHostSsrWebapp({
        hostname: opts.component.providerTarget.hostname || "",
        healthPath: opts.component.runtime.healthPath,
        connectOverride: opts.connectOverride,
      })
    : await smokeNixosSharedHostStaticWebapp({
        hostname: opts.component.providerTarget.hostname || "",
        indexPath: opts.smokeInput.indexPath,
        healthPath: opts.component.runtime.healthPath,
        connectOverride: opts.connectOverride,
      });
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
  const componentResults: NixosSharedHostComponentResult[] = [];
  for (const published of opts.published) {
    try {
      const smoke = await smokePublishedComponent({
        component: published.component,
        smokeInput: published.smokeInput,
        connectOverride: opts.smokeConnectOverride,
      });
      componentResults.push(
        withNixosSharedHostSmokeState(published.result, {
          finalOutcome: "succeeded",
          publicUrl: smoke.publicUrl,
          ...(smoke.healthUrl ? { healthUrl: smoke.healthUrl } : {}),
        }),
      );
    } catch (error) {
      const failed = withNixosSharedHostSmokeState(published.result, {
        finalOutcome: "smoke_failed_after_publish",
      });
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        failedStep: "smoke" as const,
        componentResults: [
          ...componentResults,
          failed,
          ...opts.published
            .slice(componentResults.length + 1)
            .map(({ result }) =>
              withNixosSharedHostSmokeState(result, { finalOutcome: "not_run" }),
            ),
        ],
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
