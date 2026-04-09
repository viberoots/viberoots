#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels.ts";
import type { S3StaticDeployment } from "./contract.ts";
import { parseJsoncObject } from "./cloudflare-pages-config.ts";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint.ts";

export function resolveS3StaticPublisherConfigPath(
  workspaceRoot: string,
  deployment: S3StaticDeployment,
): string {
  return path.join(
    path.resolve(workspaceRoot),
    packagePathFromLabel(deployment.label),
    deployment.publisher.config,
  );
}

function driftError(
  sourcePath: string,
  field: string,
  configured: string,
  expected: string,
): Error {
  return new Error(`${sourcePath}: ${field} ${configured} does not match deployment ${expected}`);
}

export async function prepareS3StaticPublisherConfig(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  outputPath: string;
}): Promise<{ sourcePath: string; renderedConfigPath: string; fingerprint: string }> {
  const sourcePath = resolveS3StaticPublisherConfigPath(opts.workspaceRoot, opts.deployment);
  const parsed = parseJsoncObject(await fsp.readFile(sourcePath, "utf8"), sourcePath);
  const configuredBucket = typeof parsed.bucket === "string" ? parsed.bucket.trim() : "";
  const configuredRegion = typeof parsed.region === "string" ? parsed.region.trim() : "";
  const configuredDistribution =
    typeof parsed.distribution === "string" ? parsed.distribution.trim() : "";
  if (configuredBucket && configuredBucket !== opts.deployment.providerTarget.bucket) {
    throw driftError(
      sourcePath,
      "bucket",
      configuredBucket,
      `provider_target.bucket ${opts.deployment.providerTarget.bucket}`,
    );
  }
  if (configuredRegion && configuredRegion !== opts.deployment.providerTarget.region) {
    throw driftError(
      sourcePath,
      "region",
      configuredRegion,
      `provider_target.region ${opts.deployment.providerTarget.region}`,
    );
  }
  if (
    configuredDistribution &&
    configuredDistribution !== (opts.deployment.providerTarget.distribution || "")
  ) {
    throw driftError(
      sourcePath,
      "distribution",
      configuredDistribution,
      `provider_target.distribution ${opts.deployment.providerTarget.distribution || "<empty>"}`,
    );
  }
  const rendered = {
    ...parsed,
    bucket: opts.deployment.providerTarget.bucket,
    region: opts.deployment.providerTarget.region,
    ...(opts.deployment.providerTarget.distribution
      ? { distribution: opts.deployment.providerTarget.distribution }
      : {}),
  };
  const outputPath = path.resolve(opts.outputPath);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, JSON.stringify(rendered, null, 2) + "\n", "utf8");
  return {
    sourcePath,
    renderedConfigPath: outputPath,
    fingerprint: fingerprintValue(rendered),
  };
}
