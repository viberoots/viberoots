#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { artifactTransportEnvironment } from "../lib/artifact-environment";
import type { RemoteBuilderPolicy } from "../remote-exec/nix-remote-builder-config";
import { parseRemoteBuilderSystem } from "../remote-exec/nix-remote-builder-config";
import { runRemoteBuilderSmoke } from "../remote-exec/nix-remote-builder-smoke";
import { withActiveReviewedRemoteNix } from "../remote-exec/active-reviewed-remote-nix";
import { parseReviewedRemoteBuilders } from "../remote-exec/remote-builder-authority";
import { createProtectedRustPatchEvidence } from "./protected-rust-patch-evidence";
import { runProtectedRustPatchCaseDrivers } from "./protected-rust-patch-case-driver";
import { runArtifactNix } from "./artifact-command";
import { verifyRemoteCiToolsSourceIdentity } from "./remote-ci-tools-source-identity";
import { resolveArtifactRevisionDomains } from "./artifact-revision-domains";

async function main(): Promise<void> {
  if (!String(process.env.CI || "").trim()) {
    throw new Error("protected Rust patch evidence is a CI-only entrypoint");
  }
  const system = parseRemoteBuilderSystem(required("system"));
  const remoteCiTools = required("remote-ci-tools");
  const reviewedBuilders = required("registry");
  const registry = parseReviewedRemoteBuilders(
    JSON.parse(await fs.readFile(reviewedBuilders, "utf8")),
  );
  const candidates = registry.builders.filter((builder) => builder.supportedSystem === system);
  if (candidates.length !== 2) {
    throw new Error(`protected Rust patch evidence requires two reviewed builders for ${system}`);
  }
  const slot = required("builder-slot");
  if (slot !== "one" && slot !== "two") throw new Error("builder slot must be one or two");
  const builder = candidates[slot === "one" ? 0 : 1]!;
  const remoteOptions = {
    remoteCiTools,
    transportFile: path.join(
      path.resolve(required("transport-root")),
      system,
      `${builder.identity.slice("reviewed:".length)}.json`,
    ),
    policy: required("builder-policy") as RemoteBuilderPolicy,
    expectedSystem: system,
    builderIdentity: builder.identity,
    reviewedBuilders,
    baseEnv: artifactTransportEnvironment(process.env),
  };
  const activeSmoke = await runRemoteBuilderSmoke({
    ...remoteOptions,
    probeFlake: builder.probeFlakeStorePath,
  });
  const { sourceRevision, toolSourceRevision } = await resolveArtifactRevisionDomains({
    workspaceRoot: process.cwd(),
    artifactToolsRoot: remoteCiTools,
  });
  const toolClosureSourceIdentity = await verifyRemoteCiToolsSourceIdentity({
    remoteCiTools,
    expectedToolSourceRevision: toolSourceRevision,
    runNix: async (args) =>
      await runArtifactNix({
        args,
        workspaceRoot: process.cwd(),
        artifactToolsRoot: remoteCiTools,
      }),
  });
  await withActiveReviewedRemoteNix(
    remoteOptionsWithSmoke(remoteOptions, activeSmoke),
    async (active) => {
      const cases = await runProtectedRustPatchCaseDrivers({
        active,
        remoteCiTools,
        artifactToolsRoot: remoteCiTools,
        system,
      });
      const evidence = createProtectedRustPatchEvidence({
        sourceRevision,
        toolSourceRevision,
        system,
        builderSlot: slot,
        builderAuthority: active.builderAuthority,
        remoteStoreRequired: true,
        toolClosureSourceIdentity,
        cases,
      });
      await fs.writeFile(
        path.resolve(required("output")),
        `${JSON.stringify(evidence, null, 2)}\n`,
        {
          flag: "wx",
          mode: 0o444,
        },
      );
    },
  );
}

function remoteOptionsWithSmoke<T extends object>(
  options: T,
  activeSmoke: Awaited<ReturnType<typeof runRemoteBuilderSmoke>>,
) {
  return { ...options, activeSmoke };
}

function required(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
