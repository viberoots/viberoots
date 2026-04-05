#!/usr/bin/env zx-wrapper
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels.ts";
import type { CloudflarePagesDeployment } from "./contract.ts";

type CloudflarePagesPublishResult = {
  publicUrl: string;
  providerReleaseId?: string;
};

function wranglerBin(): string {
  return process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN?.trim() || "wrangler";
}

function packageDirFor(workspaceRoot: string, deployment: CloudflarePagesDeployment): string {
  return path.join(path.resolve(workspaceRoot), packagePathFromLabel(deployment.label));
}

function maybeProviderReleaseId(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const deploymentId =
        typeof parsed.deploymentId === "string"
          ? parsed.deploymentId
          : typeof parsed.id === "string"
            ? parsed.id
            : undefined;
      if (deploymentId) return deploymentId;
    } catch {}
  }
  return undefined;
}

function commandError(stdout: string, stderr: string): string {
  return [stderr.trim(), stdout.trim()].filter(Boolean)[0] || "wrangler pages deploy failed";
}

export async function publishCloudflarePagesStaticWebapp(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactDir: string;
  renderedConfigPath: string;
}): Promise<CloudflarePagesPublishResult> {
  const result = await $({
    cwd: packageDirFor(opts.workspaceRoot, opts.deployment),
    stdio: "pipe",
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: opts.deployment.providerTarget.account,
    },
  })`${wranglerBin()} pages deploy ${path.resolve(opts.artifactDir)} --project-name ${opts.deployment.providerTarget.project} --config ${path.resolve(opts.renderedConfigPath)}`.nothrow();
  const stdout = String((result as any).stdout || "");
  const stderr = String((result as any).stderr || "");
  if ((result as any).exitCode !== 0) {
    throw new Error(commandError(stdout, stderr));
  }
  const providerReleaseId = maybeProviderReleaseId(`${stdout}\n${stderr}`);
  return {
    publicUrl: opts.deployment.providerTarget.canonicalUrl,
    ...(providerReleaseId ? { providerReleaseId } : {}),
  };
}
