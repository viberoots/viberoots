#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels";
import type { VercelDeployment } from "./contract-types";
import { parseJsoncObject } from "./cloudflare-pages-config";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";

export type VercelPublisherConfig = {
  sourcePath: string;
  renderedConfigPath: string;
  fingerprint: string;
  clientMode?: "live" | "fake";
  apiBaseUrl?: string;
  pollAttempts?: number;
  pollIntervalMs?: number;
};

export function resolveVercelPublisherConfigPath(
  workspaceRoot: string,
  deployment: VercelDeployment,
): string {
  return path.join(
    path.resolve(workspaceRoot),
    packagePathFromLabel(deployment.label),
    deployment.publisher.config,
  );
}

export async function prepareVercelPublisherConfig(opts: {
  workspaceRoot: string;
  deployment: VercelDeployment;
  outputPath: string;
}): Promise<VercelPublisherConfig> {
  const sourcePath = resolveVercelPublisherConfigPath(opts.workspaceRoot, opts.deployment);
  const parsed = parseJsoncObject(await fsp.readFile(sourcePath, "utf8"), sourcePath);
  for (const [field, expected] of [
    ["team", opts.deployment.providerTarget.team],
    ["project", opts.deployment.providerTarget.project],
    ["environment", opts.deployment.providerTarget.environment],
  ] as const) {
    const configured = typeof parsed[field] === "string" ? String(parsed[field]).trim() : "";
    if (configured && configured !== expected) {
      throw new Error(
        `${sourcePath}: vercel ${field} ${configured} does not match deployment provider_target.${field} ${expected}`,
      );
    }
  }
  if (String(parsed.mode || "").trim() === "git-autobuild") {
    throw new Error(
      `${sourcePath}: vercel git-autobuild mode is not allowed for repo-built artifacts`,
    );
  }
  const rendered = {
    ...parsed,
    team: opts.deployment.providerTarget.team,
    project: opts.deployment.providerTarget.project,
    environment: opts.deployment.providerTarget.environment,
    mode: "prebuilt",
  };
  const outputPath = path.resolve(opts.outputPath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(rendered, null, 2) + "\n", "utf8");
  const api = typeof parsed.api === "object" && parsed.api ? (parsed.api as any) : {};
  const rawMode = String(api.mode || parsed.client || "").trim();
  const clientMode = rawMode === "live" || rawMode === "fake" ? rawMode : undefined;
  return {
    sourcePath,
    renderedConfigPath: outputPath,
    fingerprint: fingerprintValue(rendered),
    ...(clientMode ? { clientMode } : {}),
    ...(typeof api.baseUrl === "string" && api.baseUrl.trim()
      ? { apiBaseUrl: api.baseUrl.trim() }
      : {}),
    ...(Number.isInteger(api.pollAttempts) ? { pollAttempts: api.pollAttempts } : {}),
    ...(Number.isInteger(api.pollIntervalMs) ? { pollIntervalMs: api.pollIntervalMs } : {}),
  };
}
