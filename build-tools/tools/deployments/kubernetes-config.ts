#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { packagePathFromLabel } from "../lib/labels.ts";
import type { KubernetesDeployment } from "./contract.ts";
import { parseJsoncObject } from "./cloudflare-pages-config.ts";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint.ts";

type KubernetesRenderedConfig = {
  chart: string;
  cluster: string;
  namespace: string;
  release: string;
  smoke_url: string;
  smoke_expect_contains?: string;
  component_artifacts: Record<string, { path: string; identity: string }>;
};

function parseConfigObject(raw: string, sourcePath: string): Record<string, unknown> {
  if (sourcePath.endsWith(".json") || sourcePath.endsWith(".jsonc")) {
    return parseJsoncObject(raw, sourcePath);
  }
  try {
    const parsed = YAML.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a YAML mapping");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${sourcePath}: invalid helm values (${String(error)})`);
  }
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requireDriftMatch(
  sourcePath: string,
  field: string,
  configured: string,
  expected: string,
): void {
  if (configured && configured !== expected) {
    throw new Error(`${sourcePath}: ${field} ${configured} does not match deployment ${expected}`);
  }
}

export function resolveKubernetesPublisherConfigPath(
  workspaceRoot: string,
  deployment: KubernetesDeployment,
): string {
  return path.join(
    path.resolve(workspaceRoot),
    packagePathFromLabel(deployment.label),
    deployment.publisher.config,
  );
}

export async function prepareKubernetesPublisherConfig(opts: {
  workspaceRoot: string;
  deployment: KubernetesDeployment;
  componentArtifacts: Record<string, { path: string; identity: string }>;
  outputPath: string;
}): Promise<{
  sourcePath: string;
  renderedConfigPath: string;
  fingerprint: string;
  chart: string;
  smokeUrl: string;
  smokeExpectContains?: string;
}> {
  const sourcePath = resolveKubernetesPublisherConfigPath(opts.workspaceRoot, opts.deployment);
  const parsed = parseConfigObject(await fsp.readFile(sourcePath, "utf8"), sourcePath);
  const configuredCluster = readString(parsed.cluster);
  const configuredNamespace = readString(parsed.namespace);
  const configuredRelease = readString(parsed.release);
  requireDriftMatch(
    sourcePath,
    "cluster",
    configuredCluster,
    `provider_target.cluster ${opts.deployment.providerTarget.cluster}`,
  );
  requireDriftMatch(
    sourcePath,
    "namespace",
    configuredNamespace,
    `provider_target.namespace ${opts.deployment.providerTarget.namespace}`,
  );
  requireDriftMatch(
    sourcePath,
    "release",
    configuredRelease,
    `provider_target.release ${opts.deployment.providerTarget.release}`,
  );
  const chart = readString(parsed.chart);
  if (!chart) throw new Error(`${sourcePath}: chart is required for helm-release publisher config`);
  const smokeUrl =
    readString(parsed.smoke_url) ||
    `https://${opts.deployment.providerTarget.release}.${opts.deployment.providerTarget.namespace}.${opts.deployment.providerTarget.cluster}/healthz`;
  const smokeExpectContains = readString(parsed.smoke_expect_contains);
  const rendered: KubernetesRenderedConfig = {
    chart,
    cluster: opts.deployment.providerTarget.cluster,
    namespace: opts.deployment.providerTarget.namespace,
    release: opts.deployment.providerTarget.release,
    smoke_url: smokeUrl,
    ...(smokeExpectContains ? { smoke_expect_contains: smokeExpectContains } : {}),
    component_artifacts: opts.componentArtifacts,
  };
  const outputPath = path.resolve(opts.outputPath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(rendered, null, 2) + "\n", "utf8");
  return {
    sourcePath,
    renderedConfigPath: outputPath,
    fingerprint: fingerprintValue(rendered),
    chart,
    smokeUrl,
    ...(smokeExpectContains ? { smokeExpectContains } : {}),
  };
}
