#!/usr/bin/env zx-wrapper

type CloudflareEnvelope<T> = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
};

type CloudflareResponse<T> = {
  status: number;
  payload: CloudflareEnvelope<T>;
};

type CloudflareZone = {
  id?: string;
  name?: string;
};

type CloudflareDnsRecord = {
  id?: string;
  type?: string;
  name?: string;
  content?: string;
  proxied?: boolean;
};

function cloudflareApiBaseUrl(): string {
  return (
    process.env.BNX_CLOUDFLARE_API_BASE_URL?.trim() || "https://api.cloudflare.com/client/v4"
  ).replace(/\/+$/, "");
}

function apiUrl(pathname: string): string {
  return `${cloudflareApiBaseUrl()}/${pathname.replace(/^\/+/, "")}`;
}

function errorSummary<T>(action: string, response: CloudflareResponse<T>): string {
  const details = response.payload.errors
    ?.map((error) =>
      [error.message, error.code ? `[code: ${error.code}]` : ""].filter(Boolean).join(" "),
    )
    .filter(Boolean)
    .join("; ");
  return details
    ? `Cloudflare DNS ${action} failed: ${details}`
    : `Cloudflare DNS ${action} failed with HTTP ${response.status}`;
}

async function cloudflareRequest<T>(
  pathname: string,
  opts: { apiToken: string; method?: "GET" | "PATCH" | "POST"; body?: unknown },
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

function zoneCandidatesFor(hostname: string): string[] {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join("."));
}

async function findZone(opts: {
  accountId: string;
  domain: string;
  apiToken: string;
}): Promise<CloudflareZone> {
  for (const candidate of zoneCandidatesFor(opts.domain)) {
    const params = new URLSearchParams({
      name: candidate,
      per_page: "1",
    });
    const response = await cloudflareRequest<CloudflareZone[]>(`/zones?${params}`, opts);
    if (response.status >= 300 || response.payload.success === false) {
      throw new Error(errorSummary("zone lookup", response));
    }
    const zone = response.payload.result?.find((item) => item.id && item.name === candidate);
    if (zone) return zone;
  }
  throw new Error(
    `Cloudflare DNS zone lookup failed: no zone found for ${opts.domain} in account ${opts.accountId}`,
  );
}

async function findCnameRecord(opts: {
  zoneId: string;
  domain: string;
  apiToken: string;
}): Promise<CloudflareDnsRecord | undefined> {
  const params = new URLSearchParams({ type: "CNAME", name: opts.domain, per_page: "1" });
  const response = await cloudflareRequest<CloudflareDnsRecord[]>(
    `/zones/${encodeURIComponent(opts.zoneId)}/dns_records?${params}`,
    opts,
  );
  if (response.status < 300 && response.payload.success !== false) {
    return response.payload.result?.[0];
  }
  throw new Error(errorSummary("record lookup", response));
}

async function writeCnameRecord(opts: {
  zoneId: string;
  recordId?: string;
  domain: string;
  content: string;
  apiToken: string;
}): Promise<CloudflareDnsRecord> {
  const body = {
    type: "CNAME",
    name: opts.domain,
    content: opts.content,
    proxied: true,
    ttl: 1,
  };
  const path = opts.recordId
    ? `/zones/${encodeURIComponent(opts.zoneId)}/dns_records/${encodeURIComponent(opts.recordId)}`
    : `/zones/${encodeURIComponent(opts.zoneId)}/dns_records`;
  const response = await cloudflareRequest<CloudflareDnsRecord>(path, {
    apiToken: opts.apiToken,
    method: opts.recordId ? "PATCH" : "POST",
    body,
  });
  if (response.status < 300 && response.payload.success !== false) {
    return response.payload.result || body;
  }
  throw new Error(errorSummary(opts.recordId ? "record update" : "record create", response));
}

export async function ensureCloudflarePagesDnsRecord(opts: {
  accountId: string;
  project: string;
  domain: string;
  apiToken: string;
}): Promise<{ zone: string; created: boolean; updated: boolean }> {
  const zone = await findZone(opts);
  if (!zone.id || !zone.name) throw new Error(`Cloudflare DNS zone lookup returned no id`);
  const content = `${opts.project}.pages.dev`;
  const existing = await findCnameRecord({ ...opts, zoneId: zone.id });
  if (existing?.content === content && existing.proxied === true) {
    return { zone: zone.name, created: false, updated: false };
  }
  await writeCnameRecord({
    ...opts,
    zoneId: zone.id,
    recordId: existing?.id,
    content,
  });
  return { zone: zone.name, created: !existing, updated: !!existing };
}
