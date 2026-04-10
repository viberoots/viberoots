#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { packagePathFromLabel } from "../lib/labels.ts";
import type { GooglePlayDeployment } from "./contract.ts";
import { parseJsoncObject } from "./cloudflare-pages-config.ts";
import { fingerprintValue } from "./nixos-shared-host-deployment-fingerprint.ts";

export function resolveGooglePlayConfigPath(
  workspaceRoot: string,
  deployment: GooglePlayDeployment,
): string {
  return path.join(
    path.resolve(workspaceRoot),
    packagePathFromLabel(deployment.label),
    deployment.publisher.config,
  );
}

export async function prepareGooglePlayPublisherConfig(opts: {
  workspaceRoot: string;
  deployment: GooglePlayDeployment;
  outputPath: string;
}): Promise<{ sourcePath: string; renderedConfigPath: string; fingerprint: string }> {
  const sourcePath = resolveGooglePlayConfigPath(opts.workspaceRoot, opts.deployment);
  const parsed = parseJsoncObject(await fsp.readFile(sourcePath, "utf8"), sourcePath);
  const driftChecks = [
    [
      "developer_account",
      parsed.developer_account,
      opts.deployment.providerTarget.developerAccount,
    ],
    ["app", parsed.app, opts.deployment.providerTarget.app],
    ["package_name", parsed.package_name, opts.deployment.providerTarget.packageName],
    ["track", parsed.track, opts.deployment.providerTarget.track],
    ["signing_model", parsed.signing_model, opts.deployment.providerTarget.signingModel],
  ] as const;
  for (const [field, configured, expected] of driftChecks) {
    if (typeof configured === "string" && configured.trim() && configured !== expected) {
      throw new Error(
        `${sourcePath}: ${field} ${configured} does not match deployment provider_target.${field} ${expected}`,
      );
    }
  }
  const rendered = {
    ...parsed,
    developer_account: opts.deployment.providerTarget.developerAccount,
    app: opts.deployment.providerTarget.app,
    package_name: opts.deployment.providerTarget.packageName,
    platform: opts.deployment.providerTarget.platform,
    track: opts.deployment.providerTarget.track,
    signing_model: opts.deployment.providerTarget.signingModel,
  };
  const renderedConfigPath = path.resolve(opts.outputPath);
  await fsp.mkdir(path.dirname(renderedConfigPath), { recursive: true });
  await fsp.writeFile(renderedConfigPath, JSON.stringify(rendered, null, 2) + "\n", "utf8");
  return { sourcePath, renderedConfigPath, fingerprint: fingerprintValue(rendered) };
}
