import fs from "node:fs/promises";
import path from "node:path";
import { artifactNixPolicyArgs } from "../lib/artifact-nix-policy";
import { runBoundedArtifactCommand } from "../lib/artifact-command-runner";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { verifyProtectedStoreSignature } from "../lib/protected-store-signature";
import type { ArtifactReproducibilityEvidence } from "../lib/artifact-reproducibility-evidence";
import {
  type RemoteBuilderPolicy,
  type RemoteBuilderSmokeEvidence,
  type RemoteBuilderSystem,
  remoteCiToolsPathEnv,
} from "./nix-remote-builder-config";
import { isActiveRemoteBuilderSmokeEvidence } from "./nix-remote-builder-smoke";
import { copyToEvidenceStore } from "../ci/evidence-store-write-transport";
import {
  canonicalJson,
  installReviewedSshHostAuthority,
  parseRemoteBuilderTransportFile,
  parseReviewedRemoteBuilders,
} from "./remote-builder-authority";

export type ActiveReviewedRemoteNix = {
  builderAuthority: ArtifactReproducibilityEvidence["builderAuthority"];
  runNix(args: string[]): Promise<{ stdout: string; stderr: string }>;
  copyToEvidenceStore(opts: {
    storeUri: string;
    storePaths: string[];
    awsSharedCredentialsFile: string;
  }): Promise<void>;
};

export type ActiveReviewedRemoteNixOptions = {
  activeSmoke: RemoteBuilderSmokeEvidence;
  remoteCiTools: string;
  transportFile: string;
  policy: RemoteBuilderPolicy;
  expectedSystem: RemoteBuilderSystem;
  reviewedBuilders: string;
  baseEnv?: NodeJS.ProcessEnv;
};

export async function validateReviewedRemoteNixAuthority(
  opts: ActiveReviewedRemoteNixOptions,
): Promise<{
  builderAuthority: ArtifactReproducibilityEvidence["builderAuthority"];
  builderUri: string;
  endpoint: ReturnType<typeof parseReviewedRemoteBuilders>["builders"][number]["endpoint"];
}> {
  const registryPath = path.resolve(opts.reviewedBuilders);
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/registry\.json$/u.test(registryPath)) {
    throw new Error("reviewed remote Nix requires the exact immutable registry file");
  }
  const smoke = opts.activeSmoke;
  if (smoke.supportedSystem !== opts.expectedSystem) {
    throw new Error("active remote smoke system does not match the evidence system");
  }
  if (smoke.builder.policy !== opts.policy) {
    throw new Error("active remote smoke policy does not match the evidence policy");
  }
  if (smoke.authorities.registryStorePath !== registryPath) {
    throw new Error("active remote smoke does not bind the exact registry");
  }
  const registryText = await fs.readFile(registryPath, "utf8");
  const registry = parseReviewedRemoteBuilders(JSON.parse(registryText));
  if (registryText !== canonicalJson(registry)) {
    throw new Error("reviewed remote Nix requires canonical registry bytes");
  }
  const selected = registry.builders.find(({ identity }) => identity === smoke.builder.identity);
  if (!selected) throw new Error("active remote smoke builder is absent from the registry");
  if (selected.supportedSystem !== opts.expectedSystem) {
    throw new Error("reviewed registry system does not match the evidence system");
  }
  if (
    selected.policyStorePath !== smoke.authorities.policyAssertionStorePath ||
    selected.probeFlakeStorePath !== smoke.authorities.probeFlakeStorePath
  ) {
    throw new Error("active remote smoke authorities do not match the registry");
  }
  const transport = parseRemoteBuilderTransportFile(opts.transportFile, selected.endpoint);
  return {
    builderUri: transport.builderUri,
    endpoint: selected.endpoint,
    builderAuthority: {
      identity: selected.identity,
      policy: opts.policy,
      supportedSystem: selected.supportedSystem,
      registryStorePath: registryPath,
      policyAssertionStorePath: selected.policyStorePath,
      probeFlakeStorePath: selected.probeFlakeStorePath,
    },
  };
}

export function remoteNixChildEnvironment(
  canonicalEnv: NodeJS.ProcessEnv,
  builderUri: string,
): NodeJS.ProcessEnv {
  return { ...canonicalEnv, NIX_REMOTE: builderUri };
}

export function remoteNixCommandArgs(args: string[]): string[] {
  return [...artifactNixPolicyArgs(), ...args];
}

export async function withActiveReviewedRemoteNix<T>(
  opts: ActiveReviewedRemoteNixOptions,
  action: (active: ActiveReviewedRemoteNix) => Promise<T>,
): Promise<T> {
  if (!isActiveRemoteBuilderSmokeEvidence(opts.activeSmoke, opts.policy)) {
    throw new Error("reviewed remote Nix requires active smoke evidence from this process");
  }
  const canonicalEnv = remoteCiToolsPathEnv(opts.remoteCiTools, opts.baseEnv || process.env);
  const nix = ensureNixStoreToolPathSync("nix", canonicalEnv);
  await verifyProtectedStoreSignature(opts.reviewedBuilders, async (args) => {
    const result = await runBoundedArtifactCommand({ command: nix, args, env: canonicalEnv });
    if (result.exitCode !== 0 || result.timedOut || result.interrupted) {
      throw new Error("reviewed remote-builder registry lacks a protected signature");
    }
    return result;
  });
  const { builderAuthority, builderUri, endpoint } = await validateReviewedRemoteNixAuthority(opts);
  const childEnv = remoteNixChildEnvironment(
    installReviewedSshHostAuthority(canonicalEnv, endpoint),
    builderUri,
  );
  return await action({
    builderAuthority,
    copyToEvidenceStore: async ({ storeUri, storePaths, awsSharedCredentialsFile }) =>
      await copyToEvidenceStore({
        nix,
        baseEnv: childEnv,
        awsSharedCredentialsFile,
        storeUri,
        storePaths,
        cwd: process.cwd(),
      }),
    runNix: async (args) => {
      const result = await runBoundedArtifactCommand({
        command: nix,
        args: remoteNixCommandArgs(args),
        cwd: process.cwd(),
        env: childEnv,
      });
      if (result.exitCode !== 0 || result.timedOut || result.interrupted) {
        throw new Error("active reviewed remote Nix command failed");
      }
      return { stdout: result.stdout, stderr: result.stderr };
    },
  });
}
