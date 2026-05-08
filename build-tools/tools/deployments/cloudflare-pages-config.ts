#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels";
import type { CloudflarePagesDeployment } from "./contract";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint";

export function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const current = raw[index] || "";
    const next = raw[index + 1] || "";
    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
        out += current;
      }
      continue;
    }
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      out += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }
    if (current === '"') {
      inString = true;
      out += current;
      continue;
    }
    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    out += current;
  }
  return out;
}

export function parseJsoncObject(raw: string, sourcePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${sourcePath}: invalid wrangler config (${String(error)})`);
  }
}

export function resolveCloudflarePagesPublisherConfigPath(
  workspaceRoot: string,
  deployment: CloudflarePagesDeployment,
): string {
  return path.join(
    path.resolve(workspaceRoot),
    packagePathFromLabel(deployment.label),
    deployment.publisher.config,
  );
}

export async function prepareCloudflarePagesWranglerConfig(opts: {
  workspaceRoot: string;
  deployment: CloudflarePagesDeployment;
  outputPath: string;
}): Promise<{ sourcePath: string; renderedConfigPath: string; fingerprint: string }> {
  const sourcePath = resolveCloudflarePagesPublisherConfigPath(opts.workspaceRoot, opts.deployment);
  const raw = await fsp.readFile(sourcePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error?.code === "ENOENT") {
      throw new Error(`${sourcePath}: missing wrangler config`);
    }
    throw error;
  });
  const parsed = parseJsoncObject(raw, sourcePath);
  const configuredName = typeof parsed.name === "string" ? String(parsed.name).trim() : undefined;
  if (configuredName && configuredName !== opts.deployment.providerTarget.project) {
    throw new Error(
      `${sourcePath}: wrangler name ${configuredName} does not match deployment provider_target.project ${opts.deployment.providerTarget.project}`,
    );
  }
  const configuredAccountId =
    typeof parsed.account_id === "string" ? String(parsed.account_id).trim() : undefined;
  const expectedAccountIds = [
    opts.deployment.providerTarget.account,
    opts.deployment.providerTarget.accountId,
  ].filter(Boolean);
  if (configuredAccountId && !expectedAccountIds.includes(configuredAccountId)) {
    throw new Error(
      `${sourcePath}: wrangler account_id ${configuredAccountId} does not match deployment provider_target.account ${opts.deployment.providerTarget.account}`,
    );
  }
  const rendered = {
    ...parsed,
    name: opts.deployment.providerTarget.project,
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
