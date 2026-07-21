#!/usr/bin/env zx-wrapper
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import {
  buildCacheManifest,
  discoverCacheAttrs,
  manifestStorePaths,
  remoteCiToolsPathEnv,
  renderPublisherCommand,
  writeManifest,
  type CacheBackendKind,
} from "./cache-manifest";
import { admitCachePublication } from "./cache-publication-policy";
import { chooseRunnableFlakeRef } from "../dev/run-runnable-source";
import {
  readArtifactSystem,
  runArtifactNix,
  runArtifactTool,
  runDeclaredArtifactPublisher,
} from "./artifact-command";
import { enterCanonicalArtifactEntrypoint } from "../dev/canonical-artifact-entrypoint";
import { withoutArtifactEnvironmentInfluence } from "../lib/artifact-environment";
import { readPublisherCredentials } from "./publisher-credentials";
import {
  buildCacheAttrs,
  packageNamesForCurrentSystem,
  readDeclaredRemoteExecutables,
  readExtraOutputs,
  readImmutableFlakeLock,
  readSourcePlans,
  readToolVersions,
  requiredImmutableSourceRoot,
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
  const source = await chooseRunnableFlakeRef({
    workspaceRoot: process.cwd(),
    sourceMode: "git",
    attr: "graph-generator",
    purpose: "cache-publication",
    artifactToolsRoot,
  });
  const flakeBase = source.flakeRef.replace(/#.*$/, "");
  try {
    const packageNames = await packageNamesForCurrentSystem(flakeBase, artifactContext);
    const selectedGraphAttrs = getRepeatedFlag("selected-graph-attr");
    const selectedTargetAttrs = getRepeatedFlag("selected-target-attr");
    const attrs = [
      ...discoverCacheAttrs(packageNames),
      ...selectedGraphAttrs,
      ...selectedTargetAttrs,
    ];
    const extra = await readExtraOutputs(getFlagStr("selected-outputs"));
    const outputPaths = await buildCacheAttrs(attrs, flakeBase, artifactContext);
    const immutableSourceRoot = requiredImmutableSourceRoot(source.workspaceRoot);
    const flakeLockText = await readImmutableFlakeLock(immutableSourceRoot);
    const manifest = buildCacheManifest({
      system: await readArtifactSystem(
        artifactContext.workspaceRoot,
        process.env,
        artifactContext.artifactToolsRoot,
      ),
      sourceRevision: source.bundleDigest,
      flakeLockText,
      attrs,
      outputPaths,
      flakeArchiveJson: JSON.parse(
        (
          await runArtifactNix({
            args: ["flake", "archive", "--json", flakeBase],
            workspaceRoot: process.cwd(),
            artifactToolsRoot,
          })
        ).stdout,
      ),
      cacheEndpoint: destination,
      backend,
      toolVersions: await readToolVersions(artifactContext),
      declaredRemoteExecutables: await readDeclaredRemoteExecutables(immutableSourceRoot),
      selectedGraphOutputs: [
        ...selectedGraphAttrs.flatMap((attr) => outputPaths[attr] || []),
        ...(extra.graph || []),
      ],
      selectedTargetOutputs: [
        ...selectedTargetAttrs.flatMap((attr) => outputPaths[attr] || []),
        ...(extra.targets || []),
      ],
      sourcePlans: await readSourcePlans(
        getFlagStr("source-plan-evidence", ""),
        immutableSourceRoot,
      ),
    });
    await mkdirWithMacosMetadataExclusion(path.dirname(out));
    writeManifest(out, manifest);
    const command = renderPublisherCommand(manifest, destination);
    console.log(
      JSON.stringify(
        {
          manifest: out,
          attrs: attrs.length,
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
        if (!publisherTool)
          throw new Error(`live ${backend} publication requires a publisher tool`);
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
        await runArtifactTool({
          tool: command[0]!,
          args: command.slice(1),
          workspaceRoot: process.cwd(),
          artifactToolsRoot,
        });
      }
    }
  } finally {
    await source.cleanup?.();
  }
}

function getRepeatedFlag(name: string): string[] {
  const prefix = `--${name}=`;
  const values: string[] = [];
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === `--${name}` && process.argv[i + 1]) {
      values.push(process.argv[++i]);
    } else if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
    }
  }
  return values.filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
