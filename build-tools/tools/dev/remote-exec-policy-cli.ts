import fs from "node:fs";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import { getArgvTokens } from "../lib/cli";
import type { RemoteExecMode, RemoteExecTargetMetadata } from "./remote-exec-policy-check";
import { parseRemoteBuilderSystem } from "../remote-exec/nix-remote-builder-config";

export function parseRemoteExecPolicyCli() {
  const tokens = getArgvTokens();
  const value = (name: string) => {
    const prefixed = tokens.find((token) => token.startsWith(`${name}=`));
    if (prefixed) return prefixed.slice(name.length + 1);
    const index = tokens.indexOf(name);
    return index >= 0 ? String(tokens[index + 1] || "") : "";
  };
  const system = value("--system");
  return {
    mode: (value("--mode") || "remote") as RemoteExecMode,
    metadataJson: value("--metadata-json"),
    profiles: value("--profiles").split(",").filter(Boolean),
    locks: value("--locks").split(",").filter(Boolean),
    remoteCiTools: value("--remote-ci-tools"),
    transportFile: value("--transport-file"),
    probeFlake: value("--probe-flake"),
    builderPolicy: value("--builder-policy"),
    builderIdentity: value("--builder-identity"),
    reviewedBuilders: value("--reviewed-builders"),
    report: value("--remote-smoke-report"),
    system: system ? parseRemoteBuilderSystem(system) : undefined,
  };
}

export async function prepareRemoteExecPolicyCli() {
  const args = parseRemoteExecPolicyCli();
  if (!args.metadataJson) throw new Error("--metadata-json is required");
  const targets = JSON.parse(
    fs.readFileSync(args.metadataJson, "utf8"),
  ) as RemoteExecTargetMetadata[];
  const remotePolicies = Array.from(
    new Set(
      targets
        .map((target) => target.nixBuilderPolicy)
        .filter((policy) => policy === "inherit_config" || policy === "force_builders_file"),
    ),
  );
  if (remotePolicies.length > 1) {
    throw new Error("one active remote admission invocation cannot mix builder policies");
  }
  let activeRemoteBuilderSmokeEvidence: unknown;
  if (remotePolicies.length === 1) {
    if (!args.system) throw new Error("--system is required for remote builder admission");
    const { runRemoteBuilderSmoke } = await import("../remote-exec/nix-remote-builder-smoke");
    activeRemoteBuilderSmokeEvidence = await runRemoteBuilderSmoke({
      reportPath: args.report || undefined,
      remoteCiTools: args.remoteCiTools,
      transportFile: args.transportFile,
      probeFlake: args.probeFlake,
      policy: remotePolicies[0] as "inherit_config" | "force_builders_file",
      expectedSystem: args.system,
      builderIdentity: args.builderIdentity,
      reviewedBuilders: args.reviewedBuilders,
      baseEnv: artifactTransportEnvironment(process.env),
    });
  }
  return { args, targets, activeRemoteBuilderSmokeEvidence };
}
