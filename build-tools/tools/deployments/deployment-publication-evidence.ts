#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import type { DeploymentAdmissionEvidence } from "./deployment-admission-evidence";

const AGGREGATE = /^\/nix\/store\/[a-z0-9]{32}-[^/]+\/aggregate\.json$/u;
const STORE_ROOT = /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u;

export function createDeploymentPublicationEvidence(opts: {
  reproducibilityAggregateStorePath: string;
  publicationOutputPath: string;
  evidenceStoreLocator: string;
}): DeploymentAdmissionEvidence {
  const reproducibilityAggregateStorePath = opts.reproducibilityAggregateStorePath.trim();
  const publicationOutputPath = opts.publicationOutputPath.trim();
  const evidenceStoreLocator = opts.evidenceStoreLocator.trim();
  if (!AGGREGATE.test(reproducibilityAggregateStorePath)) {
    throw new Error("deployment evidence requires the exact signed aggregate store path");
  }
  if (!STORE_ROOT.test(publicationOutputPath)) {
    throw new Error("deployment evidence requires one exact publication output store path");
  }
  let locator: URL;
  try {
    locator = new URL(evidenceStoreLocator);
  } catch {
    throw new Error("deployment evidence requires a credential-free evidence-store locator");
  }
  if (
    locator.protocol !== "s3:" ||
    !locator.hostname ||
    locator.username ||
    locator.password ||
    locator.search ||
    locator.hash
  ) {
    throw new Error("deployment evidence requires a credential-free evidence-store locator");
  }
  return {
    attestations: [
      { reproducibilityAggregateStorePath, publicationOutputPath, evidenceStoreLocator },
    ],
  };
}

async function main(): Promise<void> {
  const output = getFlagStr("out", "").trim();
  if (!path.isAbsolute(output)) {
    throw new Error("deployment publication evidence requires an absolute --out path");
  }
  const evidence = createDeploymentPublicationEvidence({
    reproducibilityAggregateStorePath: getFlagStr("reproducibility-aggregate", ""),
    publicationOutputPath: getFlagStr("publication-output", ""),
    evidenceStoreLocator: getFlagStr("evidence-store-locator", ""),
  });
  await mkdirWithMacosMetadataExclusion(path.dirname(output));
  await fs.writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ evidence: output, attestations: 1 }));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
