#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import {
  assertArtifactCommandSucceeded,
  runBoundedArtifactCommand,
} from "../lib/artifact-command-runner";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { remoteAdminToolsPathEnv } from "./nix-remote-builder-environment";
import {
  canonicalJson,
  parseRemoteBuilderEndpoint,
  parseReviewedRemoteBuilders,
  type ReviewedRemoteBuilderRegistry,
} from "./remote-builder-authority";
import { assertRemoteBuilderPolicyAssertionV3 } from "./remote-builder-policy-assertion";
import { verifyProtectedStoreSignature } from "../lib/protected-store-signature";
import { importRemoteBuilderAuthorities } from "./nix-remote-builder-import";

function required(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function assertionAt(storePath: string): Promise<Record<string, unknown>> {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(storePath))
    throw new Error("registration requires an immutable policy assertion directory");
  const children = await fs.readdir(storePath);
  if (children.length !== 1 || children[0] !== "assertion.json")
    throw new Error("policy assertion must be a canonical one-file directory");
  const text = await fs.readFile(path.join(storePath, "assertion.json"), "utf8");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("policy assertion must be an object");
  const assertion = value as Record<string, unknown>;
  if (text !== canonicalJson(assertion)) throw new Error("policy assertion JSON is not canonical");
  assertRemoteBuilderPolicyAssertionV3(assertion);
  return assertion;
}

export async function registerRemoteBuilder(opts: {
  identity: string;
  endpointPath: string;
  transportFile: string;
  policyStorePath: string;
  probeFlakeStorePath: string;
  evidenceStoreUri: string;
  outputRoot: string;
  previousRegistryPath?: string;
  dryRun: boolean;
  remoteCiTools?: string;
  baseEnv?: NodeJS.ProcessEnv;
}): Promise<string> {
  const endpoint = parseRemoteBuilderEndpoint(
    JSON.parse(await fs.readFile(opts.endpointPath, "utf8")),
  );
  const env = remoteAdminToolsPathEnv(
    opts.remoteCiTools || "",
    opts.baseEnv || artifactTransportEnvironment(process.env),
  );
  const nix = ensureNixStoreToolPathSync("nix", env);
  await importRemoteBuilderAuthorities({
    nix,
    endpointPath: opts.endpointPath,
    transportFile: opts.transportFile,
    policyStorePath: opts.policyStorePath,
    probeFlakeStorePath: opts.probeFlakeStorePath,
    env,
  });
  const assertion = await assertionAt(opts.policyStorePath);
  const builder = assertion.builder as Record<string, unknown> | undefined;
  if (
    builder?.identity !== opts.identity ||
    canonicalJson(builder.endpoint) !== canonicalJson(endpoint)
  )
    throw new Error("policy assertion does not bind the requested identity and endpoint");
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(opts.probeFlakeStorePath))
    throw new Error("registration requires an immutable probe flake");
  if (assertion.probeFlakeStorePath !== opts.probeFlakeStorePath) {
    throw new Error("registration probe flake does not match the attested probe authority");
  }
  let registry: ReviewedRemoteBuilderRegistry = {
    schema: "viberoots.reviewed-remote-builders.v3",
    evidenceStore: {
      schema: "viberoots.reproducibility-evidence-store.v1",
      storeUri: opts.evidenceStoreUri,
      signatures: "required",
    },
    builders: [],
  };
  if (opts.previousRegistryPath) {
    if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/registry\.json$/u.test(opts.previousRegistryPath)) {
      throw new Error("previous registry must be the exact immutable canonical registry file");
    }
    await verifyProtectedStoreSignature(opts.previousRegistryPath, async (args) => {
      const result = await runBoundedArtifactCommand({ command: nix, args, env });
      assertArtifactCommandSucceeded("previous reviewed registry signature", result);
      return result;
    });
    const text = await fs.readFile(opts.previousRegistryPath, "utf8");
    registry = parseReviewedRemoteBuilders(JSON.parse(text));
    if (text !== canonicalJson(registry))
      throw new Error("previous registry JSON is not canonical");
    if (registry.evidenceStore.storeUri !== opts.evidenceStoreUri) {
      throw new Error("registration refuses to change the reviewed evidence store authority");
    }
  }
  registry = parseReviewedRemoteBuilders(registry);
  const next = {
    identity: opts.identity as `reviewed:${string}`,
    endpoint,
    supportedSystem: String(
      assertion.supportedSystem,
    ) as ReviewedRemoteBuilderRegistry["builders"][number]["supportedSystem"],
    policyStorePath: opts.policyStorePath,
    probeFlakeStorePath: opts.probeFlakeStorePath,
  };
  const existing = registry.builders.find(({ identity }) => identity === opts.identity);
  if (existing && canonicalJson(existing) !== canonicalJson(next))
    throw new Error("registration refuses to mutate an existing immutable builder identity");
  const builders = existing
    ? registry.builders
    : [...registry.builders, next].sort((a, b) => a.identity.localeCompare(b.identity));
  const payload = canonicalJson({
    schema: registry.schema,
    evidenceStore: registry.evidenceStore,
    builders,
  });
  if (opts.dryRun) return payload;
  const root = path.resolve(opts.outputRoot);
  await fs.mkdir(root, { recursive: false, mode: 0o700 });
  await fs.writeFile(path.join(root, "registry.json"), payload, { flag: "wx", mode: 0o444 });
  const result = await runBoundedArtifactCommand({
    command: nix,
    args: ["store", "add-path", "--name", "viberoots-reviewed-remote-builders-v3", root],
    env,
    timeoutMs: 120_000,
  });
  assertArtifactCommandSucceeded("nix store add-path", result);
  const storeRoot = result.stdout.trim();
  if (!/^\/nix\/store\/[a-z0-9]{32}-viberoots-reviewed-remote-builders-v3$/u.test(storeRoot)) {
    throw new Error("reviewed remote-builder registration returned an invalid store path");
  }
  return `${storeRoot}/registry.json`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const result = await registerRemoteBuilder({
    identity: required("identity"),
    endpointPath: required("endpoint"),
    transportFile: required("transport-file"),
    policyStorePath: required("policy-assertion"),
    probeFlakeStorePath: required("probe-flake"),
    evidenceStoreUri: required("evidence-store"),
    outputRoot: dryRun ? getFlagStr("output", "") : required("output"),
    previousRegistryPath: getFlagStr("registry", "") || undefined,
    dryRun,
    remoteCiTools: required("remote-ci-tools"),
  });
  process.stdout.write(result.endsWith("\n") ? result : `${result}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
