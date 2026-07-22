#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { runBoundedArtifactCommand } from "../lib/artifact-command-runner";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { verifyProtectedStoreSignature } from "../lib/protected-store-signature";
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
import {
  canonicalJson,
  installReviewedSshHostAuthority,
  parseRemoteBuilderTransportFile,
  parseReviewedRemoteBuilders,
} from "./remote-builder-authority";
const activeEvidence = new WeakSet<object>();

export function assertTrustedRemoteStoreInfo(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("remote builder smoke requires trusted remote-store information");
  }
  if ((value as Record<string, unknown>).trusted !== true) {
    throw new Error("remote builder smoke requires a trusted remote-store connection");
  }
}

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
  transportFile: string;
  probeFlake: string;
  policy: RemoteBuilderPolicy;
  expectedSystem: RemoteBuilderSystem;
  builderIdentity: string;
  reviewedBuilders: string;
  baseEnv?: NodeJS.ProcessEnv;
  probeStoreObservation?: {
    before(runNix: (args: string[]) => Promise<{ stdout: string }>): Promise<void>;
    after(runNix: (args: string[]) => Promise<{ stdout: string }>): Promise<void>;
  };
};
function requiredFlag(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
async function readBuilderPolicyAssertion(opts: {
  nix: string;
  identity: string;
  registryPath: string;
  env: NodeJS.ProcessEnv;
}): Promise<{
  assertion: unknown;
  reviewedIdentities: string[];
  policyStorePath: string;
  probeFlakeStorePath: string;
}> {
  const registry = parseReviewedRemoteBuilders(
    JSON.parse(await fs.readFile(opts.registryPath, "utf8")),
  );
  const builders = registry.builders;
  const selected = builders.find((entry) => entry.identity === opts.identity);
  const policyStorePath =
    typeof selected?.policyStorePath === "string" ? selected.policyStorePath : "";
  const probeFlakeStorePath =
    typeof selected?.probeFlakeStorePath === "string" ? selected.probeFlakeStorePath : "";
  if (!opts.identity.startsWith("reviewed:") || !policyStorePath.startsWith("/nix/store/")) {
    throw new Error(`reviewed remote builder is not registered: ${opts.identity}`);
  }
  const result = await runBoundedArtifactCommand({
    command: opts.nix,
    args: ["store", "cat", `${policyStorePath}/assertion.json`],
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
  const probeFlake = opts.probeFlake;
  if (!probeFlake.startsWith("/nix/store/")) {
    throw new Error("--probe-flake must use the canonical immutable Nix-store source");
  }
  const policy = opts.policy;
  const nix = ensureNixStoreToolPathSync("nix", env);
  const builderIdentity = opts.builderIdentity;
  const reviewedBuilders = path.resolve(opts.reviewedBuilders);
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/registry\.json$/u.test(reviewedBuilders)) {
    throw new Error("--reviewed-builders must be the canonical immutable registry");
  }
  await verifyProtectedStoreSignature(reviewedBuilders, async (args) => {
    const result = await runBoundedArtifactCommand({ command: nix, args, env });
    if (result.exitCode !== 0 || result.timedOut || result.interrupted) {
      throw new Error("reviewed remote-builder registry lacks a protected signature");
    }
    return result;
  });
  const registryText = await fs.readFile(reviewedBuilders, "utf8");
  const registry = parseReviewedRemoteBuilders(JSON.parse(registryText));
  if (registryText !== canonicalJson(registry)) {
    throw new Error("--reviewed-builders must contain canonical registry bytes");
  }
  const selected = registry.builders.find(({ identity }) => identity === builderIdentity);
  if (!selected) throw new Error(`reviewed remote builder is not registered: ${builderIdentity}`);
  if (selected.supportedSystem !== opts.expectedSystem) {
    throw new Error("reviewed remote builder system does not match active execution system");
  }
  const transport = parseRemoteBuilderTransportFile(opts.transportFile, selected.endpoint);
  const remoteEnv = {
    ...installReviewedSshHostAuthority(env, selected.endpoint),
    NIX_REMOTE: transport.builderUri,
  };
  const remoteStoreInfo = await runBoundedArtifactCommand({
    command: nix,
    args: ["store", "info", "--json"],
    env: remoteEnv,
  });
  if (remoteStoreInfo.exitCode !== 0 || remoteStoreInfo.timedOut || remoteStoreInfo.interrupted) {
    throw new Error("reviewed remote builder did not provide trusted store information");
  }
  assertTrustedRemoteStoreInfo(JSON.parse(remoteStoreInfo.stdout));
  const observedRemoteNix = async (args: string[]): Promise<{ stdout: string }> => {
    const result = await runBoundedArtifactCommand({ command: nix, args, env: remoteEnv });
    if (result.exitCode !== 0 || result.timedOut || result.interrupted) {
      throw new Error("remote builder store observation failed");
    }
    return { stdout: result.stdout };
  };
  await opts.probeStoreObservation?.before(observedRemoteNix);
  const { assertion, reviewedIdentities, policyStorePath, probeFlakeStorePath } =
    await readBuilderPolicyAssertion({
      nix,
      identity: builderIdentity,
      registryPath: reviewedBuilders,
      env: remoteEnv,
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
  const assertionBuilder =
    assertion && typeof assertion === "object"
      ? (assertion as Record<string, unknown>).builder
      : undefined;
  const assertionEndpoint =
    assertionBuilder && typeof assertionBuilder === "object"
      ? (assertionBuilder as Record<string, unknown>).endpoint
      : undefined;
  if (canonicalJson(assertionEndpoint) !== canonicalJson(selected.endpoint)) {
    throw new Error("builder policy assertion endpoint does not match the reviewed registry");
  }
  if (
    String((assertion as Record<string, unknown>).probeFlakeStorePath || "") !== probeFlakeStorePath
  ) {
    throw new Error(
      "builder policy assertion probe authority does not match the reviewed registry",
    );
  }
  if (probeFlake !== probeFlakeStorePath) {
    throw new Error("--probe-flake does not match the reviewed builder registry");
  }
  await runRemoteBuilderProbes({ nix, probeFlake, env: remoteEnv });
  await opts.probeStoreObservation?.after(observedRemoteNix);
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
    transportFile: requiredFlag("transport-file"),
    probeFlake: requiredFlag("probe-flake"),
    policy: requiredFlag("builder-policy") as RemoteBuilderPolicy,
    expectedSystem: parseRemoteBuilderSystem(requiredFlag("system")),
    builderIdentity: requiredFlag("builder-identity"),
    reviewedBuilders: requiredFlag("reviewed-builders"),
    baseEnv: artifactTransportEnvironment(process.env),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
