#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import { REVIEWED_PUBLIC_KEYS, REVIEWED_SUBSTITUTERS } from "../lib/artifact-nix-policy";
import { artifactNixPolicyConfigArgs } from "../lib/artifact-nix-policy";
import {
  assertArtifactCommandSucceeded,
  runBoundedArtifactCommand,
} from "../lib/artifact-command-runner";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import { remoteAdminToolsPathEnv } from "./nix-remote-builder-environment";
import { parseRemoteBuilderEndpoint, canonicalJson } from "./remote-builder-authority";
import { parseRemoteBuilderSystem, type RemoteBuilderSystem } from "./nix-remote-builder-config";
import { runRemoteBuilderProbes } from "./nix-remote-builder-probes";

function required(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function configValue(config: Record<string, unknown>, name: string): unknown {
  const raw = config[name];
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw)
    return (raw as Record<string, unknown>).value;
  return raw;
}

function scalarConfig(config: Record<string, unknown>, name: string): string {
  return String(configValue(config, name) ?? "").trim();
}

function listConfig(config: Record<string, unknown>, name: string): string[] {
  const value = configValue(config, name);
  if (Array.isArray(value)) return value.map(String);
  return String(value || "")
    .split(/\s+/u)
    .filter(Boolean);
}

function pathConfig(config: Record<string, unknown>, name: string): string[] {
  const value = configValue(config, name);
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.keys(value).sort();
  return listConfig(config, name);
}

export function assertTrustedDaemonStoreInfo(info: Record<string, unknown>): void {
  if (info.url !== "daemon" || info.trusted !== true) {
    throw new Error(
      "builder attestation requires a trusted builder-local daemon for effective policy probes",
    );
  }
}

async function runJson(
  nix: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const result = await runBoundedArtifactCommand({ command: nix, args, env, timeoutMs: 600_000 });
  assertArtifactCommandSucceeded(`nix ${args[0]}`, result);
  const value: unknown = JSON.parse(result.stdout);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`nix ${args[0]} did not return an object`);
  return value as Record<string, unknown>;
}

export async function attestRemoteBuilder(opts: {
  identity: string;
  endpointPath: string;
  system: RemoteBuilderSystem;
  probeFlake: string;
  outputRoot: string;
  remoteCiTools: string;
  baseEnv?: NodeJS.ProcessEnv;
}): Promise<string> {
  if (!/^reviewed:[a-z0-9][a-z0-9._-]*$/u.test(opts.identity))
    throw new Error("remote builder attestation requires a reviewed identity");
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(opts.probeFlake))
    throw new Error("remote builder attestation requires an immutable probe flake");
  const endpoint = parseRemoteBuilderEndpoint(
    JSON.parse(await fs.readFile(opts.endpointPath, "utf8")),
  );
  const env = remoteAdminToolsPathEnv(
    opts.remoteCiTools,
    opts.baseEnv || artifactTransportEnvironment(process.env),
  );
  const nix = ensureNixStoreToolPathSync("nix", env);
  const config = await runJson(nix, artifactNixPolicyConfigArgs(), env);
  const storeInfo = await runJson(nix, ["store", "info", "--json"], env);
  assertTrustedDaemonStoreInfo(storeInfo);
  const sandboxPaths = [
    ...pathConfig(config, "sandbox-paths"),
    ...pathConfig(config, "extra-sandbox-paths"),
  ];
  const substituters = listConfig(config, "substituters");
  const publicKeys = listConfig(config, "trusted-public-keys");
  if (scalarConfig(config, "system") !== opts.system) {
    throw new Error("builder attestation system does not match the builder-local Nix system");
  }
  if (scalarConfig(config, "sandbox") !== "true")
    throw new Error("builder attestation requires effective sandbox=true");
  if (scalarConfig(config, "sandbox-fallback") !== "false")
    throw new Error("builder attestation requires sandbox-fallback=false");
  if (sandboxPaths.length) throw new Error("builder attestation rejects extra sandbox host paths");
  if (JSON.stringify(substituters) !== JSON.stringify(REVIEWED_SUBSTITUTERS))
    throw new Error("builder attestation rejects unreviewed substituters");
  if (JSON.stringify(publicKeys) !== JSON.stringify(REVIEWED_PUBLIC_KEYS))
    throw new Error("builder attestation rejects unreviewed public keys");
  await runRemoteBuilderProbes({ nix, probeFlake: opts.probeFlake, env });
  const assertion = {
    schema: "viberoots.remote-builder-policy-assertion.v3",
    supportedSystem: opts.system,
    probeFlakeStorePath: opts.probeFlake,
    builder: { identity: opts.identity, endpoint },
    effectivePolicy: {
      inspection: "trusted-builder-daemon-with-live-canaries",
      sandbox: true,
      sandboxFallback: false,
      hostPaths: [],
      multiUser: "daemon",
      substituters,
      publicKeys,
    },
    probes: {
      ordinaryHostRead: "denied",
      ordinaryNetwork: "denied",
      fixedOutputCorrectHash: "passed",
      fixedOutputWrongHash: "denied",
      store: "passed",
    },
  };
  const root = path.resolve(opts.outputRoot);
  await fs.mkdir(root, { recursive: false, mode: 0o700 });
  await fs.writeFile(path.join(root, "assertion.json"), canonicalJson(assertion), {
    flag: "wx",
    mode: 0o444,
  });
  const added = await runBoundedArtifactCommand({
    command: nix,
    args: ["store", "add-path", "--name", "viberoots-remote-builder-policy-v3", root],
    env,
    timeoutMs: 120_000,
  });
  assertArtifactCommandSucceeded("nix store add-path", added);
  const storePath = added.stdout.trim();
  if (!/^\/nix\/store\/[a-z0-9]{32}-viberoots-remote-builder-policy-v3$/u.test(storePath)) {
    throw new Error("remote builder attestation returned an invalid store path");
  }
  return storePath;
}

async function main(): Promise<void> {
  const storePath = await attestRemoteBuilder({
    identity: required("identity"),
    endpointPath: required("endpoint"),
    system: parseRemoteBuilderSystem(required("system")),
    probeFlake: required("probe-flake"),
    outputRoot: required("output"),
    remoteCiTools: required("remote-ci-tools"),
  });
  process.stdout.write(`${storePath}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
