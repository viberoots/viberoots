#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CloudflarePagesDeployment } from "./contract.ts";
import { scrubDeploymentSecretEnv } from "./deployment-secret-env.ts";

type CloudflarePagesPublishResult = {
  publicUrl: string;
  providerReleaseId?: string;
};

function wranglerBin(): string {
  return process.env.BNX_CLOUDFLARE_PAGES_WRANGLER_BIN?.trim() || "wrangler";
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

function maybePublicUrl(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.url === "string" && parsed.url.trim()) return parsed.url.trim();
    } catch {}
  }
  return undefined;
}

function commandError(stdout: string, stderr: string): string {
  const output = [stderr.trim(), stdout.trim()].filter(Boolean)[0] || "";
  const clean = output
    .replace(/\u001b\[[0-9;]*m/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !/^Logs were written to /.test(line));
  return clean ? `wrangler pages deploy failed: ${clean}` : "wrangler pages deploy failed";
}

async function withDefaultWranglerConfig(renderedConfigPath: string): Promise<string> {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-cloudflare-pages-wrangler-"));
  await fsp.copyFile(path.resolve(renderedConfigPath), path.join(workDir, "wrangler.json"));
  return workDir;
}

export async function publishCloudflarePagesStaticWebapp(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  artifactDir: string;
  renderedConfigPath: string;
  effectiveRunTarget?: CloudflarePagesDeployment["providerTarget"];
  apiToken?: string;
  timeoutMs?: number;
}): Promise<CloudflarePagesPublishResult> {
  const effectiveRunTarget = opts.effectiveRunTarget || opts.deployment.providerTarget;
  const wranglerWorkDir = await withDefaultWranglerConfig(opts.renderedConfigPath);
  try {
    const command = $({
      cwd: wranglerWorkDir,
      stdio: "pipe",
      env: {
        ...scrubDeploymentSecretEnv(),
        CLOUDFLARE_ACCOUNT_ID: opts.deployment.providerTarget.account,
        ...(opts.apiToken ? { CLOUDFLARE_API_TOKEN: opts.apiToken } : {}),
      },
    })`${wranglerBin()} pages deploy ${path.resolve(opts.artifactDir)} --project-name ${opts.deployment.providerTarget.project} ${effectiveRunTarget.previewBranch ? ["--branch", effectiveRunTarget.previewBranch] : []}`;
    const result = await (opts.timeoutMs ? command.timeout(opts.timeoutMs) : command).nothrow();
    const stdout = String((result as any).stdout || "");
    const stderr = String((result as any).stderr || "");
    if ((result as any).exitCode !== 0) {
      throw new Error(commandError(stdout, stderr));
    }
    const providerReleaseId = maybeProviderReleaseId(`${stdout}\n${stderr}`);
    const publicUrl = maybePublicUrl(`${stdout}\n${stderr}`) || effectiveRunTarget.canonicalUrl;
    return {
      publicUrl,
      ...(providerReleaseId ? { providerReleaseId } : {}),
    };
  } finally {
    await fsp.rm(wranglerWorkDir, { recursive: true, force: true });
  }
}
