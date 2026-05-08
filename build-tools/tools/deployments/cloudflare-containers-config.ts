#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels";
import type { CloudflareContainersDeployment } from "./contract";
import { parseJsoncObject } from "./cloudflare-pages-config";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";

function readObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
      )
    : [];
}

function validateRoutes(opts: {
  sourcePath: string;
  parsed: Record<string, unknown>;
  deployment: CloudflareContainersDeployment;
}) {
  const routes = readObjectArray(opts.parsed.routes);
  if (opts.deployment.providerTarget.ingressMode !== "public") {
    if (routes.length > 0) {
      throw new Error(
        `${opts.sourcePath}: non-public cloudflare-containers ingress must not define routes`,
      );
    }
    return;
  }
  const domain = opts.deployment.providerTarget.domain;
  if (!domain) {
    if (routes.length > 0) {
      throw new Error(
        `${opts.sourcePath}: workers.dev cloudflare-containers ingress must not define custom routes`,
      );
    }
    return;
  }
  const matchingRoute = routes.find((route) => String(route.pattern || "").trim() === domain);
  if (!matchingRoute) throw new Error(`${opts.sourcePath}: missing route for domain ${domain}`);
  if (matchingRoute.custom_domain !== true) {
    throw new Error(`${opts.sourcePath}: route for ${domain} must set custom_domain=true`);
  }
  if (
    String(matchingRoute.zone_id || "").trim() !== opts.deployment.providerTarget.cloudflareZoneId
  ) {
    throw new Error(
      `${opts.sourcePath}: route for ${domain} must use deployment cloudflare_zone_id`,
    );
  }
}

function validateContainerConfig(
  sourcePath: string,
  parsed: Record<string, unknown>,
  deployment: CloudflareContainersDeployment,
) {
  const containers = readObjectArray(parsed.containers);
  const container = containers[0];
  if (!container) throw new Error(`${sourcePath}: missing containers entry`);
  const expectedMaxInstances = Number(deployment.providerTarget.maxInstances || 1);
  if (container.max_instances !== expectedMaxInstances) {
    throw new Error(
      `${sourcePath}: containers[0].max_instances does not match deployment metadata`,
    );
  }
  if (String(container.sleep_after || "").trim() !== deployment.providerTarget.sleepAfter) {
    throw new Error(`${sourcePath}: containers[0].sleep_after does not match deployment metadata`);
  }
}

export function resolveCloudflareContainersPublisherConfigPath(
  workspaceRoot: string,
  deployment: CloudflareContainersDeployment,
): string {
  return path.join(
    path.resolve(workspaceRoot),
    packagePathFromLabel(deployment.label),
    deployment.publisher.config,
  );
}

export async function prepareCloudflareContainersWranglerConfig(opts: {
  workspaceRoot: string;
  deployment: CloudflareContainersDeployment;
  outputPath: string;
}): Promise<{ sourcePath: string; renderedConfigPath: string; fingerprint: string }> {
  const sourcePath = resolveCloudflareContainersPublisherConfigPath(
    opts.workspaceRoot,
    opts.deployment,
  );
  const raw = await fsp.readFile(sourcePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "ENOENT") throw new Error(`${sourcePath}: missing wrangler config`);
    throw error;
  });
  const parsed = parseJsoncObject(raw, sourcePath);
  const configuredName = typeof parsed.name === "string" ? parsed.name.trim() : undefined;
  if (configuredName && configuredName !== opts.deployment.providerTarget.worker) {
    throw new Error(
      `${sourcePath}: wrangler name ${configuredName} does not match deployment worker ${opts.deployment.providerTarget.worker}`,
    );
  }
  validateRoutes({ sourcePath, parsed, deployment: opts.deployment });
  validateContainerConfig(sourcePath, parsed, opts.deployment);
  const rendered = { ...parsed, name: opts.deployment.providerTarget.worker };
  const outputPath = path.resolve(opts.outputPath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(rendered, null, 2) + "\n", "utf8");
  return { sourcePath, renderedConfigPath: outputPath, fingerprint: fingerprintValue(rendered) };
}
