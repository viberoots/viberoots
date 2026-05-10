#!/usr/bin/env zx-wrapper
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels";
import type { S3StaticDeployment } from "./contract";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env";

function awsBin(): string {
  return process.env.VBR_S3_STATIC_AWS_BIN?.trim() || "aws";
}

function packageDirFor(workspaceRoot: string, deployment: S3StaticDeployment): string {
  return path.join(path.resolve(workspaceRoot), packagePathFromLabel(deployment.label));
}

function maybeProviderReleaseId(output: string): string | undefined {
  for (const line of output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .reverse()) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.syncId === "string" && parsed.syncId.trim()) return parsed.syncId.trim();
    } catch {}
  }
  return undefined;
}

export async function publishS3StaticWebapp(opts: {
  workspaceRoot: string;
  deployment: S3StaticDeployment;
  artifactDir: string;
  renderedConfigPath: string;
}): Promise<{ publicUrl: string; providerReleaseId?: string }> {
  const result = await $({
    cwd: packageDirFor(opts.workspaceRoot, opts.deployment),
    stdio: "pipe",
    env: {
      ...scrubDeploymentSecretEnv(),
      AWS_DEFAULT_REGION: opts.deployment.providerTarget.region,
      VBR_S3_STATIC_RENDERED_CONFIG: path.resolve(opts.renderedConfigPath),
    },
  })`${awsBin()} s3 sync ${path.resolve(opts.artifactDir)} s3://${opts.deployment.providerTarget.bucket} --delete --exact-timestamps`.nothrow();
  const stdout = String((result as any).stdout || "");
  const stderr = String((result as any).stderr || "");
  if ((result as any).exitCode !== 0) {
    throw new Error([stderr.trim(), stdout.trim()].filter(Boolean)[0] || "aws s3 sync failed");
  }
  return {
    publicUrl: opts.deployment.providerTarget.canonicalUrl,
    ...(maybeProviderReleaseId(`${stdout}\n${stderr}`)
      ? { providerReleaseId: maybeProviderReleaseId(`${stdout}\n${stderr}`) }
      : {}),
  };
}
