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

function cloudflareAccountEnv(deployment: CloudflarePagesDeployment): Record<string, string> {
  return deployment.providerTarget.accountId
    ? { CLOUDFLARE_ACCOUNT_ID: deployment.providerTarget.accountId }
    : {};
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

const MAX_WRANGLER_ERROR_LENGTH = 160;

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function cleanWranglerErrorLine(line: string): string {
  return line
    .trim()
    .replace(/^[^\w/]*(?:\[ERROR\]\s*)?/i, "")
    .replace(/\s+/g, " ");
}

function safeWranglerError(text: string): string {
  const safe = text.replace(/[^\w .,:;_/#()+\-"'\[\]@]/g, "").trim();
  return safe.length > MAX_WRANGLER_ERROR_LENGTH
    ? `${safe.slice(0, MAX_WRANGLER_ERROR_LENGTH - 3).trimEnd()}...`
    : safe;
}

export function summarizeWranglerPagesDeployError(stdout: string, stderr: string): string {
  const output = [stderr.trim(), stdout.trim()].filter(Boolean)[0] || "";
  const plain = stripAnsi(output);
  const requestMatch = plain.match(/A request to the Cloudflare API \(([^)]+)\) failed\./);
  const detailMatch = plain.match(/([A-Za-z][^\r\n]*\(status: \d+\) \[code: \d+\])/);
  if (requestMatch?.[1] && detailMatch?.[1]) {
    return `wrangler pages deploy failed: ${safeWranglerError(
      `Cloudflare API ${requestMatch[1]}: ${detailMatch[1]}`,
    )}`;
  }
  const clean = plain
    .split(/\r?\n/)
    .map(cleanWranglerErrorLine)
    .filter(Boolean)
    .find((line) => !/^Logs were written to /.test(line));
  return clean
    ? `wrangler pages deploy failed: ${safeWranglerError(clean)}`
    : "wrangler pages deploy failed";
}

function commandError(stdout: string, stderr: string): string {
  return summarizeWranglerPagesDeployError(stdout, stderr);
}

async function withDefaultWranglerConfig(renderedConfigPath: string): Promise<string> {
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bnx-cloudflare-pages-wrangler-"));
  await fsp.copyFile(path.resolve(renderedConfigPath), path.join(workDir, "wrangler.json"));
  return workDir;
}

async function withPagesWranglerConfig(
  renderedConfigPath: string,
  artifactDir: string,
): Promise<string> {
  const workDir = await withDefaultWranglerConfig(renderedConfigPath);
  const configPath = path.join(workDir, "wrangler.json");
  const rendered = JSON.parse(await fsp.readFile(configPath, "utf8")) as Record<string, unknown>;
  await fsp.writeFile(
    configPath,
    JSON.stringify(
      {
        ...rendered,
        pages_build_output_dir: path.resolve(artifactDir),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
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
  const wranglerWorkDir = await withPagesWranglerConfig(opts.renderedConfigPath, opts.artifactDir);
  try {
    const command = $({
      cwd: wranglerWorkDir,
      stdio: "pipe",
      env: {
        ...scrubDeploymentSecretEnv(),
        ...(opts.apiToken ? { CLOUDFLARE_API_TOKEN: opts.apiToken } : {}),
        ...cloudflareAccountEnv(opts.deployment),
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
