#!/usr/bin/env zx-wrapper
import type { NixosSharedHostDeployment, NixosSharedHostDeploymentComponent } from "./contract.ts";
import type {
  DeploymentSmokeException,
  DeploymentSmokeExecutionMode,
} from "./deployment-smoke-policy.ts";
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
import { smokeNixosSharedHostComponent } from "./nixos-shared-host-publish-smoke.ts";
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
  allowLiveComponentReuse: boolean;
}): Promise<PublishedComponent | undefined> {
  if (!opts.allowLiveComponentReuse) return undefined;
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

export async function smokeNixosSharedHostPublishedComponents(opts: {
  deployment: NixosSharedHostDeployment;
  published: PublishedComponent[];
  smokeMode?: DeploymentSmokeExecutionMode;
  smokeException?: DeploymentSmokeException;
  smokeConnectOverride?: {
    protocol: "http:" | "https:";
    hostname: string;
    port: number;
    rejectUnauthorized?: boolean;
  };
}): Promise<{
  componentResults: NixosSharedHostComponentResult[];
  smokeOutcome: "passed" | "failed_nonblocking" | "omitted_by_exception";
  smokeException?: DeploymentSmokeException;
  smokeError?: string;
  publicUrl?: string;
  healthUrl?: string;
}> {
  const primaryComponent = primaryNixosSharedHostComponent(opts.deployment);
  if ((opts.smokeMode || "blocking") === "omitted") {
    const primaryPublished = opts.published.find(
      (published) => published.component.id === primaryComponent.id,
    );
    return {
      componentResults: opts.published.map(({ result }) =>
        withNixosSharedHostSmokeState(result, { finalOutcome: "omitted_by_exception" }),
      ),
      smokeOutcome: "omitted_by_exception",
      ...(opts.smokeException ? { smokeException: opts.smokeException } : {}),
      ...(primaryPublished?.component.providerTarget.canonicalUrl
        ? { publicUrl: primaryPublished.component.providerTarget.canonicalUrl }
        : {}),
    };
  }
  const componentResults: NixosSharedHostComponentResult[] = [];
  for (const published of opts.published) {
    try {
      const smoke = await smokeNixosSharedHostComponent({
        component: published.component,
        smokeInput: published.smokeInput,
        connectOverride: opts.smokeConnectOverride,
      });
      componentResults.push(
        withNixosSharedHostSmokeState(published.result, {
          finalOutcome: "succeeded",
          smokeOutcome: "passed",
          publicUrl: smoke.publicUrl,
          ...(smoke.healthUrl ? { healthUrl: smoke.healthUrl } : {}),
        }),
      );
    } catch (error) {
      if ((opts.smokeMode || "blocking") === "nonblocking") {
        const primaryPublished = opts.published.find(
          (entry) => entry.component.id === primaryComponent.id,
        );
        const failedResult = withNixosSharedHostSmokeState(published.result, {
          finalOutcome: "smoke_failed_nonblocking",
          smokeOutcome: "failed_nonblocking",
          smokeError: error instanceof Error ? error.message : String(error),
        });
        return {
          componentResults: [
            ...componentResults,
            failedResult,
            ...opts.published
              .slice(componentResults.length + 1)
              .map(({ result }) =>
                withNixosSharedHostSmokeState(result, { finalOutcome: "not_run" }),
              ),
          ],
          smokeOutcome: "failed_nonblocking",
          ...(opts.smokeException ? { smokeException: opts.smokeException } : {}),
          smokeError: error instanceof Error ? error.message : String(error),
          ...(primaryPublished?.component.providerTarget.canonicalUrl
            ? { publicUrl: primaryPublished.component.providerTarget.canonicalUrl }
            : {}),
        };
      }
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
    smokeOutcome: "passed",
    ...(opts.smokeException ? { smokeException: opts.smokeException } : {}),
    ...(primaryResult?.publicUrl ? { publicUrl: primaryResult.publicUrl } : {}),
    ...(primaryResult?.healthUrl ? { healthUrl: primaryResult.healthUrl } : {}),
  };
}
