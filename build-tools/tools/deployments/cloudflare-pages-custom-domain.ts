#!/usr/bin/env zx-wrapper
import { ensureCloudflarePagesDnsRecord } from "./cloudflare-dns-records.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";

type CloudflarePagesDomain = {
  name?: string;
  status?: string;
  validation_status?: string;
};

type CloudflareEnvelope<T> = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
};

type CloudflareResponse<T> = {
  status: number;
  payload: CloudflareEnvelope<T>;
};

export type CloudflarePagesCustomDomainEnsureResult =
  | { kind: "not-configured" }
  | {
      kind: "ready";
      domain: string;
      created: boolean;
      status?: string;
      validationStatus?: string;
    };

function cloudflareApiBaseUrl(): string {
  return (
    process.env.BNX_CLOUDFLARE_API_BASE_URL?.trim() || "https://api.cloudflare.com/client/v4"
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
    `cloudflare-pages custom domain requires provider_target.account_id for ${deployment.label}`,
  );
}

function domainStatus(domain: CloudflarePagesDomain | undefined): {
  status?: string;
  validationStatus?: string;
} {
  return {
    ...(domain?.status ? { status: domain.status } : {}),
    ...(domain?.validation_status ? { validationStatus: domain.validation_status } : {}),
  };
}

function errorSummary<T>(action: string, response: CloudflareResponse<T>): string {
  const details = response.payload.errors
    ?.map((error) =>
      [error.message, error.code ? `[code: ${error.code}]` : ""].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join("; ");
  return details
    ? `Cloudflare Pages custom domain ${action} failed: ${details}`
    : `Cloudflare Pages custom domain ${action} failed with HTTP ${response.status}`;
}

function isMissingDomain<T>(response: CloudflareResponse<T>): boolean {
  return (
    response.status === 404 ||
    response.payload.errors?.some((error) =>
      /not found|does not exist/i.test(error.message || ""),
    ) ||
    false
  );
}

function isAlreadyPresent<T>(response: CloudflareResponse<T>): boolean {
  return (
    response.status === 409 ||
    response.payload.errors?.some((error) =>
      /already|exist|associated/i.test(error.message || ""),
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

async function fetchDomain(opts: {
  accountId: string;
  project: string;
  domain: string;
  apiToken: string;
}): Promise<CloudflarePagesDomain | undefined> {
  const response = await cloudflareRequest<CloudflarePagesDomain>(
    `/accounts/${encodeURIComponent(opts.accountId)}/pages/projects/${encodeURIComponent(opts.project)}/domains/${encodeURIComponent(opts.domain)}`,
    { apiToken: opts.apiToken },
  );
  if (response.status < 300 && response.payload.success !== false) return response.payload.result;
  if (isMissingDomain(response)) return undefined;
  throw new Error(errorSummary("lookup", response));
}

async function addDomain(opts: {
  accountId: string;
  project: string;
  domain: string;
  apiToken: string;
}): Promise<CloudflarePagesDomain> {
  const response = await cloudflareRequest<CloudflarePagesDomain>(
    `/accounts/${encodeURIComponent(opts.accountId)}/pages/projects/${encodeURIComponent(opts.project)}/domains`,
    {
      apiToken: opts.apiToken,
      method: "POST",
      body: { name: opts.domain },
    },
  );
  if (response.status < 300 && response.payload.success !== false) {
    return response.payload.result || { name: opts.domain };
  }
  if (isAlreadyPresent(response)) {
    return (await fetchDomain(opts)) || { name: opts.domain };
  }
  throw new Error(errorSummary("create", response));
}

export async function ensureCloudflarePagesCustomDomain(opts: {
  deployment: CloudflarePagesDeployment;
  apiToken?: string;
}): Promise<CloudflarePagesCustomDomainEnsureResult> {
  const domain = opts.deployment.providerTarget.customDomain?.trim();
  if (!domain) return { kind: "not-configured" };
  const apiToken = opts.apiToken?.trim();
  if (!apiToken) {
    throw new Error("cloudflare-pages custom domain provisioning requires a Cloudflare API token");
  }
  const accountId = accountIdFor(opts.deployment);
  const request = {
    accountId,
    project: opts.deployment.providerTarget.project,
    domain,
    zoneId: opts.deployment.providerTarget.customDomainZoneId,
    apiToken,
  };
  const existing = await fetchDomain(request);
  if (existing) {
    await ensureCloudflarePagesDnsRecord(request);
    return { kind: "ready", domain, created: false, ...domainStatus(existing) };
  }
  const created = await addDomain(request);
  await ensureCloudflarePagesDnsRecord(request);
  return { kind: "ready", domain, created: true, ...domainStatus(created) };
}
