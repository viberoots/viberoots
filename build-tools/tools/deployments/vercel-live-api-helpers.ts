#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { redactDeploymentAuthText } from "./deployment-auth-redaction";
import { VercelApiOutcomeError } from "./vercel-api-errors";

export type UploadedVercelFile = { file: string; sha: string; size: number };

export function vercelApiQuery(team: string): string {
  return team.trim() ? `?slug=${encodeURIComponent(team.trim())}` : "";
}

export async function readVercelOutputFiles(
  root: string,
  current = root,
): Promise<UploadedVercelFile[]> {
  const entries = await fsp.readdir(current, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) return readVercelOutputFiles(root, fullPath);
      if (!entry.isFile()) return [];
      const data = await fsp.readFile(fullPath);
      return [
        {
          file: path.relative(root, fullPath).split(path.sep).join("/"),
          sha: crypto.createHash("sha1").update(data).digest("hex"),
          size: data.length,
        },
      ];
    }),
  );
  return files.flat().sort((a, b) => a.file.localeCompare(b.file));
}

export async function uploadVercelFile(opts: {
  baseUrl: string;
  apiToken: string;
  team: string;
  outputDir: string;
  file: UploadedVercelFile;
}) {
  const body = await fsp.readFile(path.join(opts.outputDir, opts.file.file));
  const response = await fetch(`${opts.baseUrl}/v2/files${vercelApiQuery(opts.team)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.apiToken}`,
      "content-length": String(opts.file.size),
      "content-type": "application/octet-stream",
      "x-vercel-digest": opts.file.sha,
    },
    body,
  });
  await requireVercelOk(response, `upload ${opts.file.file}`);
}

export async function vercelJsonRequest<T>(opts: {
  baseUrl: string;
  apiToken: string;
  method: string;
  path: string;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(`${opts.baseUrl}${opts.path}`, {
    method: opts.method,
    headers: {
      authorization: `Bearer ${opts.apiToken}`,
      "content-type": "application/json",
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  await requireVercelOk(response, opts.path);
  return (await response.json()) as T;
}

async function requireVercelOk(response: Response, context: string) {
  if (response.ok) return;
  const text = redactDeploymentAuthText(await response.text());
  throw new VercelApiOutcomeError(`vercel API ${context} failed with ${response.status}: ${text}`, {
    outcome: "failed",
  });
}

export function vercelDeploymentStatus(body: any): string {
  return String(body?.readyState || body?.status || body?.state || "").toUpperCase();
}

export function vercelDeploymentUrl(body: any): string {
  const value = String(body?.url || "");
  return value.startsWith("http") ? value : value ? `https://${value}/` : "";
}

export async function pollVercelDeployment(opts: {
  baseUrl: string;
  apiToken: string;
  team: string;
  deploymentId: string;
  initialPublicUrl?: string;
  pollAttempts: number;
  pollIntervalMs: number;
}): Promise<any> {
  let lastPublicUrl = opts.initialPublicUrl || "";
  for (let attempt = 0; attempt < opts.pollAttempts; attempt += 1) {
    const body = await vercelJsonRequest<any>({
      baseUrl: opts.baseUrl,
      apiToken: opts.apiToken,
      method: "GET",
      path: `/v13/deployments/${encodeURIComponent(opts.deploymentId)}${vercelApiQuery(opts.team)}`,
    });
    const status = vercelDeploymentStatus(body);
    lastPublicUrl = vercelDeploymentUrl(body) || lastPublicUrl;
    if (status === "READY") return body;
    if (["ERROR", "CANCELED", "CANCELLED"].includes(status)) {
      throw new VercelApiOutcomeError(`vercel deployment ${opts.deploymentId} failed: ${status}`, {
        outcome: "failed",
        providerReleaseId: opts.deploymentId,
        publicUrl: vercelDeploymentUrl(body),
      });
    }
    if (opts.pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, opts.pollIntervalMs));
    }
  }
  throw new VercelApiOutcomeError(`vercel deployment ${opts.deploymentId} is still pending`, {
    outcome: "pending",
    providerReleaseId: opts.deploymentId,
    ...(lastPublicUrl ? { publicUrl: lastPublicUrl } : {}),
  });
}

export async function assignVercelAliases(opts: {
  baseUrl: string;
  apiToken: string;
  team: string;
  deploymentId: string;
  aliases: string[];
}): Promise<boolean> {
  for (const alias of opts.aliases) {
    await vercelJsonRequest({
      baseUrl: opts.baseUrl,
      apiToken: opts.apiToken,
      method: "POST",
      path: `/v2/deployments/${encodeURIComponent(opts.deploymentId)}/aliases${vercelApiQuery(opts.team)}`,
      body: { alias, redirect: null },
    });
  }
  return opts.aliases.length > 0;
}
