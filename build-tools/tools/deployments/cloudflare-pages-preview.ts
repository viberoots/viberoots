#!/usr/bin/env zx-wrapper
import { createHash } from "node:crypto";
import { sanitizeName } from "../lib/sanitize.ts";
import type { CloudflarePagesDeployment, CloudflarePagesProviderTarget } from "./contract.ts";

export type CloudflarePagesPreviewIdentitySelector = {
  kind: "source_run";
  sourceRunId: string;
};

export type CloudflarePagesPreviewCleanupReason =
  | "manual_cleanup"
  | "ttl_expiry"
  | "pr_close"
  | "superseded_preview";

const VALID_PREVIEW_CLEANUP_REASONS = new Set<CloudflarePagesPreviewCleanupReason>([
  "manual_cleanup",
  "ttl_expiry",
  "pr_close",
  "superseded_preview",
]);

function normalizedPreviewBranch(sourceRunId: string, project: string): string {
  const sanitized = sanitizeName(sourceRunId)
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  if (!sanitized) throw new Error("preview source run id must resolve to a stable branch token");
  const hostSuffix = `.${project}.pages.dev`;
  const maxBranchLength = 64 - hostSuffix.length;
  if (maxBranchLength < 12) {
    throw new Error(
      `cloudflare-pages preview hostname budget is too small for ${project}; shorten the project name first`,
    );
  }
  const hashSuffix = createHash("sha256").update(sourceRunId).digest("hex").slice(0, 8);
  const prefixBudget = maxBranchLength - "prv--".length - hashSuffix.length;
  const prefix = sanitized.slice(0, Math.max(prefixBudget, 0)).replace(/-+$/g, "");
  return prefix ? `prv-${prefix}-${hashSuffix}` : `prv-${hashSuffix}`;
}

export function requireCloudflarePagesPreviewSupport(
  deployment: CloudflarePagesDeployment,
): NonNullable<CloudflarePagesDeployment["preview"]> {
  if (!deployment.preview) {
    throw new Error(
      `cloudflare-pages preview is not enabled for ${deployment.label}; add explicit preview metadata first`,
    );
  }
  return deployment.preview;
}

export function cloudflarePagesPreviewIdentitySelector(
  sourceRunId: string,
): CloudflarePagesPreviewIdentitySelector {
  return {
    kind: "source_run",
    sourceRunId: sourceRunId.trim(),
  };
}

export function normalizeCloudflarePagesPreviewCleanupReason(
  value: string,
): CloudflarePagesPreviewCleanupReason {
  const normalized = value.trim() as CloudflarePagesPreviewCleanupReason;
  if (VALID_PREVIEW_CLEANUP_REASONS.has(normalized)) return normalized;
  throw new Error(
    `unsupported preview cleanup reason "${value || "<empty>"}"; expected one of ${Array.from(VALID_PREVIEW_CLEANUP_REASONS).join(", ")}`,
  );
}

export function deriveCloudflarePagesPreviewTarget(
  deployment: CloudflarePagesDeployment,
  sourceRunId: string,
): CloudflarePagesProviderTarget {
  requireCloudflarePagesPreviewSupport(deployment);
  const previewBranch = normalizedPreviewBranch(sourceRunId, deployment.providerTarget.project);
  const { customDomain: _customDomain, ...providerTarget } = deployment.providerTarget;
  return {
    ...providerTarget,
    canonicalUrl: `https://${previewBranch}.${deployment.providerTarget.project}.pages.dev/`,
    providerTargetIdentity: `${deployment.providerTarget.providerTargetIdentity}#preview:${previewBranch}`,
    previewBranch,
    previewSourceRunId: sourceRunId,
  };
}

export function cloudflarePagesPublishedPath(
  publishRoot: string,
  target: Pick<CloudflarePagesProviderTarget, "project" | "previewBranch">,
): string {
  return target.previewBranch
    ? `${publishRoot.replace(/\/$/, "")}/${target.project}--preview--${target.previewBranch}`
    : `${publishRoot.replace(/\/$/, "")}/${target.project}`;
}
