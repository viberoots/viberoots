#!/usr/bin/env zx-wrapper
import type { CloudflarePagesDeployment } from "./contract";

type CloudflareEnvelope<T> = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
};

type CloudflareResponse<T> = {
  status: number;
  payload: CloudflareEnvelope<T>;
};

type CloudflarePagesProject = {
  name?: string;
  production_branch?: string;
};

export type CloudflarePagesProjectEnsureResult = {
  kind: "ready";
  project: string;
  created: boolean;
  productionBranch: string;
};

function cloudflareApiBaseUrl(): string {
  return (
    process.env.VBR_CLOUDFLARE_API_BASE_URL?.trim() || "https://api.cloudflare.com/client/v4"
  ).replace(/\/+$/, "");
}

function apiUrl(pathname: string): string {
  return `${cloudflareApiBaseUrl()}/${pathname.replace(/^\/+/, "")}`;
}

function accountIdFor(deployment: CloudflarePagesDeployment): string {
  const target = deployment.providerTarget;
  const accountId =
    target.accountId || (/^[0-9a-f]{32}$/.test(target.account) ? target.account : "");
  if (accountId) return accountId;
  throw new Error(
    `cloudflare-pages project requires provider_target.account_id for ${deployment.label}`,
  );
}

function productionBranchFor(deployment: CloudflarePagesDeployment): string {
  return deployment.admissionPolicy.allowedRefs[0] || "main";
}

function errorSummary<T>(action: string, response: CloudflareResponse<T>): string {
  const details = response.payload.errors
    ?.map((error) =>
      [error.message, error.code ? `[code: ${error.code}]` : ""].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join("; ");
  return details
    ? `Cloudflare Pages project ${action} failed: ${details}`
    : `Cloudflare Pages project ${action} failed with HTTP ${response.status}`;
}

function isMissingProject<T>(response: CloudflareResponse<T>): boolean {
  return (
    response.status === 404 ||
    response.payload.errors?.some((error) =>
      /project not found|not found|does not exist/i.test(error.message || ""),
    ) ||
    false
  );
}

async function cloudflareRequest<T>(
  pathname: string,
  opts: { apiToken: string; method?: "GET" | "POST"; body?: unknown },
): Promise<CloudflareResponse<T>> {
  const response = await fetch(apiUrl(pathname), {
    method: opts.method || "GET",
    headers: {
      Authorization: `Bearer ${opts.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json;charset=UTF-8",
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as CloudflareEnvelope<T>;
  return { status: response.status, payload };
}

async function fetchProject(opts: {
  accountId: string;
  project: string;
  apiToken: string;
}): Promise<CloudflarePagesProject | undefined> {
  const response = await cloudflareRequest<CloudflarePagesProject>(
    `/accounts/${encodeURIComponent(opts.accountId)}/pages/projects/${encodeURIComponent(opts.project)}`,
    { apiToken: opts.apiToken },
  );
  if (response.status < 300 && response.payload.success !== false) return response.payload.result;
  if (isMissingProject(response)) return undefined;
  throw new Error(errorSummary("lookup", response));
}

async function createProject(opts: {
  accountId: string;
  project: string;
  productionBranch: string;
  apiToken: string;
}): Promise<CloudflarePagesProject> {
  const response = await cloudflareRequest<CloudflarePagesProject>(
    `/accounts/${encodeURIComponent(opts.accountId)}/pages/projects`,
    {
      apiToken: opts.apiToken,
      method: "POST",
      body: { name: opts.project, production_branch: opts.productionBranch },
    },
  );
  if (response.status < 300 && response.payload.success !== false) {
    return (
      response.payload.result || { name: opts.project, production_branch: opts.productionBranch }
    );
  }
  throw new Error(errorSummary("create", response));
}

export async function ensureCloudflarePagesProject(opts: {
  deployment: CloudflarePagesDeployment;
  apiToken?: string;
}): Promise<CloudflarePagesProjectEnsureResult> {
  const apiToken = opts.apiToken?.trim();
  if (!apiToken)
    throw new Error("cloudflare-pages project provisioning requires a Cloudflare API token");
  const accountId = accountIdFor(opts.deployment);
  const project = opts.deployment.providerTarget.project;
  const productionBranch = productionBranchFor(opts.deployment);
  const existing = await fetchProject({ accountId, project, apiToken });
  if (existing) {
    return {
      kind: "ready",
      project,
      created: false,
      productionBranch: existing.production_branch || productionBranch,
    };
  }
  await createProject({ accountId, project, productionBranch, apiToken });
  return { kind: "ready", project, created: true, productionBranch };
}
