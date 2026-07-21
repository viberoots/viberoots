#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import {
  buildCanonicalArtifactEnvironment,
  canonicalArtifactToolsRoot,
} from "../lib/artifact-environment";
import { artifactNixPolicyArgs } from "../lib/artifact-nix-policy";
import { runBoundedArtifactCommand } from "../lib/artifact-command-runner";
import { ensureNixStoreToolPathSync } from "../lib/tool-paths";
import {
  readMaterializationManifest,
  redactCommand,
  redactEndpoint,
  redactMaterializationManifest,
  type NixStoreMaterializationManifest,
  type StorePathEntry,
} from "./nix-store-materialization-manifest";

export {
  parseMaterializationManifest,
  readMaterializationManifest,
  redactMaterializationManifest,
  type NixStoreMaterializationManifest,
  type StorePathEntry,
} from "./nix-store-materialization-manifest";

export type MaterializationReport = {
  path: string;
  attr: string;
  narHash?: string;
  substituterUsed: string;
  durationMs: number;
  cache: "hit" | "miss" | "dry-run";
  command: string[];
};

type Runner = (command: string[]) => Promise<{ stdout: string; stderr: string }>;

export function renderMaterializationCommand(
  manifest: NixStoreMaterializationManifest,
  entry: StorePathEntry,
  nix = `${manifest.tools.nix}/bin/nix`,
): string[] {
  if (manifest.substituter.endpointIdentity) {
    return [
      nix,
      "copy",
      "--from",
      manifest.substituter.endpointIdentity,
      "--option",
      "trusted-public-keys",
      manifest.substituter.trustedPublicKeys.join(" "),
      ...artifactNixPolicyArgs(),
      entry.path,
    ];
  }
  return [
    nix,
    "build",
    `${manifest.sourceSnapshot}#${entry.attr}`,
    ...artifactNixPolicyArgs(),
    "--no-link",
    "--print-out-paths",
  ];
}

export async function materializeNixStorePaths(opts: {
  manifest: NixStoreMaterializationManifest;
  artifactToolsRoot: string;
  dryRun?: boolean;
  runner?: Runner;
}): Promise<MaterializationReport[]> {
  if (!opts.artifactToolsRoot) {
    throw new Error(
      "materializeNixStorePaths requires an explicit artifactToolsRoot; the caller must resolve authority at the public boundary.",
    );
  }
  const artifactEnv = buildCanonicalArtifactEnvironment(process.cwd(), {
    artifactToolsRoot: opts.artifactToolsRoot,
  });
  const closureNix = path.join(String(artifactEnv.VBR_ARTIFACT_TOOLS_ROOT), "bin", "nix");
  const nix = ensureNixStoreToolPathSync("nix", {
    ...artifactEnv,
    VBR_NIX_BIN: closureNix,
    NIX_BIN: closureNix,
  });
  const declaredNix = path.join(opts.manifest.tools.nix, "bin", "nix");
  let declaredNixReal: string;
  let canonicalNixReal: string;
  try {
    declaredNixReal = fs.realpathSync(declaredNix);
    canonicalNixReal = fs.realpathSync(nix);
  } catch (error) {
    throw new Error("materialization manifest Nix authority is unavailable", { cause: error });
  }
  if (declaredNixReal !== canonicalNixReal) {
    throw new Error(
      "materialization manifest Nix authority does not match the canonical tool closure",
    );
  }
  const runner = opts.runner || ((command) => defaultRunner(command, artifactEnv));
  const reports: MaterializationReport[] = [];
  for (const entry of opts.manifest.storePaths) {
    const command = renderMaterializationCommand(opts.manifest, entry, nix);
    const started = performance.now();
    if (opts.dryRun) {
      reports.push(report(entry, opts.manifest, command, started, "dry-run"));
      continue;
    }
    const result = await runner(command);
    const realized = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    if (realized && realized !== entry.path) {
      throw new Error(`materialized ${entry.attr} as ${realized}, expected ${entry.path}`);
    }
    if (!realized) {
      const verify = await runner(pathInfoCommand(nix, entry));
      const present = verify.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!present.includes(entry.path)) {
        throw new Error(`materialized ${entry.attr} did not verify expected ${entry.path}`);
      }
    }
    reports.push(report(entry, opts.manifest, command, started, realized ? "miss" : "hit"));
  }
  return reports;
}

function pathInfoCommand(nix: string, entry: StorePathEntry): string[] {
  return [nix, ...artifactNixPolicyArgs(), "path-info", entry.path];
}

async function defaultRunner(
  command: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  const result = await runBoundedArtifactCommand({
    command: command[0]!,
    args: command.slice(1),
    env,
    timeoutMs: 600_000,
  });
  if (result.exitCode !== 0 || result.timedOut || result.interrupted) {
    throw new Error(result.stderr || `nix exited ${result.exitCode}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

function report(
  entry: StorePathEntry,
  manifest: NixStoreMaterializationManifest,
  command: string[],
  started: number,
  cache: MaterializationReport["cache"],
): MaterializationReport {
  return {
    path: entry.path,
    attr: entry.attr,
    narHash: entry.narHash,
    substituterUsed: redactEndpoint(manifest.substituter.endpointIdentity),
    durationMs: Math.round(performance.now() - started),
    cache,
    command: redactCommand(command),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = readMaterializationManifest(getFlagStr("manifest"));
  const artifactToolsRoot = canonicalArtifactToolsRoot(
    process.cwd(),
    String(process.env.VBR_ARTIFACT_TOOLS_ROOT || ""),
  );
  const reports = await materializeNixStorePaths({
    manifest,
    artifactToolsRoot,
    dryRun: getFlagBool("dry-run"),
  });
  process.stdout.write(
    `${JSON.stringify({ manifest: redactMaterializationManifest(manifest), reports }, null, 2)}\n`,
  );
}
