#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { runBoundedArtifactCommand } from "../lib/artifact-command-runner";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import {
  buildRemoteBuilderSmokeEvidence,
  parseRemoteBuilderSystem,
  remoteCiToolsPathEnv,
  type RemoteBuilderPolicy,
  type RemoteBuilderSystem,
  type RemoteBuilderSmokeEvidence,
} from "./nix-remote-builder-config";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import { runRemoteBuilderProbes } from "./nix-remote-builder-probes";
const activeEvidence = new WeakSet<object>();

export function isActiveRemoteBuilderSmokeEvidence(
  value: unknown,
  policy: RemoteBuilderPolicy,
): value is RemoteBuilderSmokeEvidence {
  return (
    Boolean(value && typeof value === "object" && activeEvidence.has(value as object)) &&
    (value as RemoteBuilderSmokeEvidence).builder.policy === policy
  );
}

export type RunRemoteBuilderSmokeOptions = {
  reportPath?: string;
  remoteCiTools: string;
  builderUri: string;
  probeFlake: string;
  policy: RemoteBuilderPolicy;
  expectedSystem: RemoteBuilderSystem;
  builderIdentity: string;
  reviewedBuilders: string;
  baseEnv?: NodeJS.ProcessEnv;
};
function requiredFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
async function readBuilderPolicyAssertion(opts: {
  nix: string;
  builderUri: string;
  identity: string;
  registryPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<{
  assertion: unknown;
  reviewedIdentities: string[];
  policyStorePath: string;
  probeFlakeStorePath: string;
}> {
  const registry = JSON.parse(await fs.readFile(opts.registryPath, "utf8")) as {
    schema?: unknown;
    builders?: unknown;
  };
  if (
    registry.schema !== "viberoots.reviewed-remote-builders.v1" ||
    !Array.isArray(registry.builders)
  ) {
    throw new Error("--reviewed-builders must contain the reviewed remote-builder registry");
  }
  const builders = registry.builders as Array<Record<string, unknown>>;
  const selected = builders.find((entry) => entry.identity === opts.identity);
  const policyStorePath =
    typeof selected?.policyStorePath === "string" ? selected.policyStorePath : "";
  const probeFlakeStorePath =
    typeof selected?.probeFlakeStorePath === "string" ? selected.probeFlakeStorePath : "";
  const reviewedBuilderUri =
    typeof selected?.builderUri === "string" ? selected.builderUri.trim() : "";
  if (!opts.identity.startsWith("reviewed:") || !policyStorePath.startsWith("/nix/store/")) {
    throw new Error(`reviewed remote builder is not registered: ${opts.identity}`);
  }
  if (!reviewedBuilderUri || opts.builderUri !== reviewedBuilderUri) {
    throw new Error("--builder-uri does not match the reviewed builder registry");
  }
  const result = await runBoundedArtifactCommand({
    command: opts.nix,
    args: ["store", "cat", "--store", opts.builderUri, policyStorePath],
    env: opts.env,
    timeoutMs: 600_000,
  });
  if (result.exitCode !== 0 || result.timedOut || result.interrupted) {
    throw new Error("reviewed builder did not return its immutable policy assertion");
  }
  return {
    assertion: JSON.parse(result.stdout),
    reviewedIdentities: builders.map((entry) => String(entry.identity || "")).filter(Boolean),
    policyStorePath,
    probeFlakeStorePath,
  };
}

async function atomicWrite(reportPath: string, text: string): Promise<void> {
  const parent = path.dirname(reportPath);
  await fs.mkdir(parent, { recursive: true });
  const temp = path.join(parent, `.${path.basename(reportPath)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temp, text, { mode: 0o600, flag: "wx" });
    await fs.rename(temp, reportPath);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export async function runRemoteBuilderSmoke(
  opts: RunRemoteBuilderSmokeOptions,
): Promise<RemoteBuilderSmokeEvidence> {
  const env = remoteCiToolsPathEnv(opts.remoteCiTools, opts.baseEnv || process.env);
  const builderUri = opts.builderUri;
  const probeFlake = opts.probeFlake;
  if (!probeFlake.startsWith("/nix/store/")) {
    throw new Error("--probe-flake must use the canonical immutable Nix-store source");
  }
  const policy = opts.policy;
  const nix = ensureNixStoreToolPathSync("nix", env);
  const builderIdentity = opts.builderIdentity;
  const reviewedBuilders = path.resolve(opts.reviewedBuilders);
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+(?:\/[^/]+)?$/u.test(reviewedBuilders)) {
    throw new Error("--reviewed-builders must be the canonical immutable registry");
  }
  const { assertion, reviewedIdentities, policyStorePath, probeFlakeStorePath } =
    await readBuilderPolicyAssertion({
      nix,
      builderUri,
      identity: builderIdentity,
      registryPath: reviewedBuilders,
      env,
    });
  const assertionSystem = String(
    assertion && typeof assertion === "object"
      ? (assertion as Record<string, unknown>).supportedSystem || ""
      : "",
  );
  if (assertionSystem !== opts.expectedSystem) {
    throw new Error(
      `remote builder policy system does not match active execution system: expected=${opts.expectedSystem} actual=${assertionSystem || "<missing>"}`,
    );
  }
  if (probeFlake !== probeFlakeStorePath) {
    throw new Error("--probe-flake does not match the reviewed builder registry");
  }
  await runRemoteBuilderProbes({ nix, builderUri, probeFlake, env });
  const report = buildRemoteBuilderSmokeEvidence(assertion, {
    policy,
    expectedSystem: opts.expectedSystem,
    reviewedBuilderIdentities: reviewedIdentities,
    authorities: {
      registryStorePath: reviewedBuilders,
      policyAssertionStorePath: policyStorePath,
      probeFlakeStorePath,
    },
  });
  if (report.builder.identity !== builderIdentity) {
    throw new Error("builder policy assertion identity does not match the reviewed builder");
  }
  activeEvidence.add(report);
  if (opts.reportPath) {
    const reportPath = path.resolve(opts.reportPath);
    await fs.rm(reportPath, { force: true });
    await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

async function main() {
  await runRemoteBuilderSmoke({
    reportPath: requiredFlag("report"),
    remoteCiTools: getFlagStr("remote-ci-tools", process.env.VBR_REMOTE_CI_TOOLS || ""),
    builderUri: requiredFlag("builder-uri"),
    probeFlake: requiredFlag("probe-flake"),
    policy: requiredFlag("builder-policy") as RemoteBuilderPolicy,
    expectedSystem: parseRemoteBuilderSystem(requiredFlag("system")),
    builderIdentity: requiredFlag("builder-identity"),
    reviewedBuilders: requiredFlag("reviewed-builders"),
    baseEnv: artifactTransportEnvironment(process.env),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
