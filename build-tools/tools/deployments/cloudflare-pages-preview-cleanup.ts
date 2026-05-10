#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import type { CloudflarePagesDeployment, CloudflarePagesProviderTarget } from "./contract";
import { cloudflarePagesPublishedPath } from "./cloudflare-pages-preview";

async function cleanupFakePreviewTarget(
  effectiveRunTarget: Pick<CloudflarePagesProviderTarget, "project" | "previewBranch">,
): Promise<boolean> {
  const publishRoot = process.env.VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT?.trim();
  if (!publishRoot) return false;
  await fsp.rm(cloudflarePagesPublishedPath(publishRoot, effectiveRunTarget), {
    recursive: true,
    force: true,
  });
  return true;
}

async function deleteCloudflarePagesDeployment(opts: {
  deployment: CloudflarePagesDeployment;
  providerReleaseId: string;
  apiToken?: string;
  allowAmbientProviderToken?: boolean;
}): Promise<void> {
  const apiToken =
    opts.apiToken?.trim() ||
    (opts.allowAmbientProviderToken ? process.env.CLOUDFLARE_API_TOKEN?.trim() : "");
  if (!apiToken) {
    throw new Error("cloudflare-pages preview cleanup requires an admitted Cloudflare API token");
  }
  const accountId =
    opts.deployment.providerTarget.accountId || opts.deployment.providerTarget.account;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(opts.deployment.providerTarget.project)}/deployments/${encodeURIComponent(opts.providerReleaseId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json;charset=UTF-8",
      },
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
  };
  if (response.ok && payload.success !== false) return;
  const message =
    payload.errors?.map((entry) => entry.message || "").find(Boolean) ||
    `cloudflare-pages preview cleanup failed with HTTP ${response.status}`;
  throw new Error(message);
}

export async function cleanupCloudflarePagesPreview(opts: {
  deployment: CloudflarePagesDeployment;
  effectiveRunTarget: CloudflarePagesProviderTarget;
  providerReleaseId?: string;
  apiToken?: string;
  allowAmbientProviderToken?: boolean;
}): Promise<void> {
  if (!opts.effectiveRunTarget.previewBranch) {
    throw new Error("cloudflare-pages preview cleanup requires an isolated preview target");
  }
  if (await cleanupFakePreviewTarget(opts.effectiveRunTarget)) return;
  if (!opts.providerReleaseId) {
    throw new Error(
      `cloudflare-pages preview cleanup requires a recorded provider release id for ${opts.effectiveRunTarget.providerTargetIdentity}`,
    );
  }
  await deleteCloudflarePagesDeployment({
    deployment: opts.deployment,
    providerReleaseId: opts.providerReleaseId,
    apiToken: opts.apiToken,
    allowAmbientProviderToken: opts.allowAmbientProviderToken,
  });
}
