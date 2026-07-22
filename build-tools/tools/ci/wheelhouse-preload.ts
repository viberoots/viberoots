import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import { buildCacheManifest, renderPublisherCommand, writeManifest } from "./cache-manifest";
import { admitCachePublication } from "./cache-publication-policy";
import { chooseRunnableFlakeRef } from "../dev/run-runnable-source";
import { readArtifactSystem, runArtifactNix } from "./artifact-command";
import {
  readSignedReproducibilityAggregate,
  stageSystemReproducibilityOutputs,
} from "./cache-publication-inputs";

export async function runWheelhousePreload(artifactToolsRoot: string): Promise<void> {
  const to = getFlagStr("to", "");
  await admitCachePublication({
    env: process.env,
    diagnosticImpure: getFlagBool("impure"),
    artifactToolsRoot,
  });
  const artifactContext = { workspaceRoot: process.cwd(), artifactToolsRoot };
  const reproducibilityAggregate = to
    ? await readSignedReproducibilityAggregate(
        getFlagStr("reproducibility-aggregate", ""),
        getFlagStr("evidence-store-locator", ""),
        artifactContext,
      )
    : undefined;
  const manifestOut = getFlagStr("manifest-out", "buck-out/tmp/wheelhouse-cache-manifest.json");
  const system = await readArtifactSystem(process.cwd(), process.env, artifactToolsRoot);
  if (reproducibilityAggregate) {
    await stageSystemReproducibilityOutputs(reproducibilityAggregate, system, artifactContext);
    const manifest = buildCacheManifest({
      system,
      cacheEndpoint: to,
      backend: "nix-copy",
      reproducibilityAggregate,
    });
    await mkdirWithMacosMetadataExclusion(path.dirname(manifestOut));
    writeManifest(manifestOut, manifest);
    const command = renderPublisherCommand(manifest, to, reproducibilityAggregate);
    await runArtifactNix({
      args: command.slice(1),
      workspaceRoot: process.cwd(),
      artifactToolsRoot,
    });
    console.log(
      `wheelhouse-preload: pushed ${manifest.attrs.length} protected outputs to ${manifest.cacheEndpointIdentity}`,
    );
    return;
  }
  const source = await chooseRunnableFlakeRef({
    workspaceRoot: process.cwd(),
    sourceMode: "git",
    attr: "graph-generator",
    purpose: "cache-publication",
    artifactToolsRoot,
  });
  const flakeBase = source.flakeRef.replace(/#.*$/, "");
  try {
    const keys = await packageKeys(system, flakeBase, artifactToolsRoot);
    const attrs = discoverWheelhouseCacheAttrs(keys);
    if (!attrs.length) {
      console.log("wheelhouse-preload: no wheelhouse outputs found; nothing to do");
      return;
    }
    const refs = attrs.map((attr) => `${flakeBase}${attr.slice(1)}`);
    await runArtifactNix({
      args: ["build", "--accept-flake-config", "--no-link", "--print-out-paths", ...refs],
      workspaceRoot: process.cwd(),
      artifactToolsRoot,
    });
    console.log(`wheelhouse-preload: built ${attrs.length} local wheelhouse outputs`);
  } finally {
    await source.cleanup?.();
  }
}

function discoverWheelhouseCacheAttrs(packageNames: string[]): string[] {
  return [
    ...new Set(
      packageNames.filter((name) => name.startsWith("py-wheelhouse-")).map((name) => `.#${name}`),
    ),
  ];
}

async function packageKeys(
  system: string,
  flakeBase: string,
  artifactToolsRoot: string,
): Promise<string[]> {
  const evalOut = await runArtifactNix({
    args: ["eval", "--json", "--accept-flake-config", `${flakeBase}#packages.${system}`],
    workspaceRoot: process.cwd(),
    artifactToolsRoot,
  });
  return Object.keys(JSON.parse(evalOut.stdout || "{}") || {});
}
