#!/usr/bin/env zx-wrapper
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";
import { VercelApiOutcomeError } from "./vercel-api-errors";
import {
  assignVercelAliases,
  pollVercelDeployment,
  readVercelOutputFiles,
  uploadVercelFile,
  vercelApiQuery,
  vercelDeploymentStatus,
  vercelDeploymentUrl,
  vercelJsonRequest,
} from "./vercel-live-api-helpers";

export { VercelApiOutcomeError } from "./vercel-api-errors";

export type VercelApiDeployRequest = {
  team: string;
  project: string;
  environment: string;
  artifactIdentity: string;
  outputDir: string;
  sourceRunId?: string;
  aliases?: string[];
};

export type VercelApiDeployResult = {
  deploymentId: string;
  url: string;
  aliasAssigned: boolean;
};

type VercelLiveClientOptions = {
  apiToken: string;
  baseUrl?: string;
  pollAttempts?: number;
  pollIntervalMs?: number;
};

export type VercelApiClient = {
  publishPrebuilt(request: VercelApiDeployRequest): Promise<VercelApiDeployResult>;
  cleanupPreview?(request: {
    team: string;
    project: string;
    sourceRunId: string;
    providerDeploymentId?: string;
  }): Promise<{ deploymentId: string; cleaned: boolean }>;
};

function stableDeploymentId(request: VercelApiDeployRequest): string {
  return fingerprintValue({
    provider: "vercel",
    team: request.team,
    project: request.project,
    environment: request.environment,
    artifactIdentity: request.artifactIdentity,
    sourceRunId: request.sourceRunId || "",
  }).slice("sha256:".length, "sha256:".length + 24);
}

export function createFakeVercelApiClient(): VercelApiClient {
  return {
    async publishPrebuilt(request) {
      const suffix = stableDeploymentId(request);
      return {
        deploymentId: `dpl_${suffix}`,
        url: `https://${request.project}-${suffix.slice(0, 8)}.vercel.app/`,
        aliasAssigned: request.environment !== "preview",
      };
    },
    async cleanupPreview(request) {
      const suffix = fingerprintValue(request).slice("sha256:".length, "sha256:".length + 16);
      return { deploymentId: `dpl_${suffix}`, cleaned: true };
    },
  };
}

export function createLiveVercelApiClient(opts: VercelLiveClientOptions): VercelApiClient {
  const baseUrl = (opts.baseUrl || "https://api.vercel.com").replace(/\/+$/, "");
  const pollAttempts = opts.pollAttempts ?? 60;
  const pollIntervalMs = opts.pollIntervalMs ?? 5000;
  return {
    async publishPrebuilt(request) {
      const files = await readVercelOutputFiles(request.outputDir);
      for (const file of files) {
        await uploadVercelFile({
          baseUrl,
          apiToken: opts.apiToken,
          team: request.team,
          outputDir: request.outputDir,
          file,
        });
      }
      const created = await vercelJsonRequest<any>({
        baseUrl,
        apiToken: opts.apiToken,
        method: "POST",
        path: `/v13/deployments${vercelApiQuery(request.team)}`,
        body: {
          name: request.project,
          project: request.project,
          target: request.environment === "preview" ? undefined : request.environment,
          prebuilt: true,
          files,
          meta: {
            artifactIdentity: request.artifactIdentity,
            ...(request.sourceRunId ? { sourceRunId: request.sourceRunId } : {}),
          },
        },
      });
      const deploymentId = String(created?.id || created?.uid || "").trim();
      if (!deploymentId) {
        throw new VercelApiOutcomeError("vercel API returned ambiguous publish outcome", {
          outcome: "ambiguous",
          publicUrl: vercelDeploymentUrl(created),
        });
      }
      const createdUrl = vercelDeploymentUrl(created);
      let ready = created;
      if (vercelDeploymentStatus(created) !== "READY") {
        try {
          ready = await pollVercelDeployment({
            baseUrl,
            apiToken: opts.apiToken,
            team: request.team,
            deploymentId,
            ...(createdUrl ? { initialPublicUrl: createdUrl } : {}),
            pollAttempts,
            pollIntervalMs,
          });
        } catch (error) {
          if (error instanceof VercelApiOutcomeError) {
            error.providerReleaseId ||= deploymentId;
            error.publicUrl ||= createdUrl;
          }
          throw error;
        }
      }
      const url = vercelDeploymentUrl(ready);
      if (!url) {
        throw new VercelApiOutcomeError("vercel API returned ambiguous publish URL", {
          outcome: "ambiguous",
          providerReleaseId: deploymentId,
          ...(createdUrl ? { publicUrl: createdUrl } : {}),
        });
      }
      let aliasAssigned = false;
      try {
        aliasAssigned = await assignVercelAliases({
          baseUrl,
          apiToken: opts.apiToken,
          team: request.team,
          deploymentId,
          aliases: request.aliases || [],
        });
      } catch (error) {
        if (error instanceof VercelApiOutcomeError) {
          error.providerReleaseId ||= deploymentId;
          error.publicUrl ||= url;
        }
        throw error;
      }
      return { deploymentId, url, aliasAssigned };
    },
    async cleanupPreview(request) {
      const deploymentId = String(request.providerDeploymentId || "").trim();
      if (!deploymentId) {
        throw new VercelApiOutcomeError("vercel preview cleanup has no provider deployment id", {
          outcome: "ambiguous",
        });
      }
      const deleted = await vercelJsonRequest<any>({
        baseUrl,
        apiToken: opts.apiToken,
        method: "DELETE",
        path: `/v13/deployments/${encodeURIComponent(deploymentId)}${vercelApiQuery(request.team)}`,
      });
      return { deploymentId, cleaned: String(deleted?.state || "").toUpperCase() === "DELETED" };
    },
  };
}
