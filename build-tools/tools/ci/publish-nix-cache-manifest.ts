#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import {
  buildCacheManifest,
  manifestStorePaths,
  remoteCiToolsPathEnv,
  renderPublisherCommand,
  writeManifest,
  type CacheBackendKind,
} from "./cache-manifest";
import { admitCachePublication } from "./cache-publication-policy";
import {
  readArtifactSystem,
  runArtifactNix,
  runDeclaredArtifactPublisher,
} from "./artifact-command";
import { enterCanonicalArtifactEntrypoint } from "../dev/canonical-artifact-entrypoint";
import { withoutArtifactEnvironmentInfluence } from "../lib/artifact-environment";
import { readPublisherCredentials } from "./publisher-credentials";
import {
  readSignedReproducibilityAggregate,
  stageSystemReproducibilityOutputs,
} from "./cache-publication-inputs";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint();

function cacheBackend(value: string): CacheBackendKind {
  if (value === "none" || value === "nix-copy" || value === "attic" || value === "cachix") {
    return value;
  }
  throw new Error(`unsupported cache backend ${value}`);
}

async function main() {
  const artifactContext = { workspaceRoot: process.cwd(), artifactToolsRoot };
  const out = getFlagStr("out", "buck-out/tmp/nix-cache-manifest.json");
  const backend = cacheBackend(getFlagStr("backend", "none"));
  const destination = getFlagStr("to", "");
  const dryRun = getFlagBool("dry-run") || backend === "none";
  const publisherTool =
    backend === "attic" || backend === "cachix"
      ? path.join(
          String(
            remoteCiToolsPathEnv(
              getFlagStr("remote-ci-tools", ""),
              withoutArtifactEnvironmentInfluence(process.env),
            ).PATH || "",
          ),
          backend,
        )
      : undefined;
  await admitCachePublication({
    env: process.env,
    diagnosticImpure: getFlagBool("impure"),
    toolPaths: publisherTool ? { [backend]: publisherTool } : undefined,
    artifactToolsRoot,
  });
  const reproducibilityAggregate = await readSignedReproducibilityAggregate(
    getFlagStr("reproducibility-aggregate", ""),
    getFlagStr("evidence-store-locator", ""),
    artifactContext,
  );
  const system = await readArtifactSystem(
    artifactContext.workspaceRoot,
    process.env,
    artifactContext.artifactToolsRoot,
  );
  await stageSystemReproducibilityOutputs(reproducibilityAggregate, system, artifactContext);
  const manifest = buildCacheManifest({
    system,
    cacheEndpoint: destination,
    backend,
    declaredRemoteExecutables: publisherTool ? [backend] : [],
    reproducibilityAggregate,
  });
  await mkdirWithMacosMetadataExclusion(path.dirname(out));
  writeManifest(out, manifest);
  const command = renderPublisherCommand(manifest, destination, reproducibilityAggregate);
  console.log(
    JSON.stringify(
      {
        manifest: out,
        attrs: manifest.attrs.length,
        dryRun,
        backend,
        cacheEndpointIdentity: manifest.cacheEndpointIdentity,
        outputPaths: manifestStorePaths(manifest).length,
      },
      null,
      2,
    ),
  );
  if (!dryRun && command.length) {
    if (backend === "attic" || backend === "cachix") {
      if (!publisherTool) throw new Error(`live ${backend} publication requires a publisher tool`);
      const publisherEnv = await readPublisherCredentials({
        backend,
        file: getFlagStr("publisher-env-file", ""),
        required: true,
      });
      await runDeclaredArtifactPublisher({
        tool: backend,
        args: command.slice(1),
        workspaceRoot: process.cwd(),
        artifactToolsRoot,
        declaredToolPath: publisherTool,
        publisherEnv,
      });
    } else {
      await runArtifactNix({
        args: command.slice(1),
        workspaceRoot: process.cwd(),
        artifactToolsRoot,
      });
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
