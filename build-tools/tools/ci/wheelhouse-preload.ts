import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import {
  buildCacheManifest,
  discoverWheelhouseCacheAttrs,
  renderPublisherCommand,
  writeManifest,
} from "./cache-manifest";
import { admitCachePublication } from "./cache-publication-policy";
import { chooseRunnableFlakeRef } from "../dev/run-runnable-source";
import { readArtifactSystem, runArtifactNix, runArtifactTool } from "./artifact-command";

export async function runWheelhousePreload(artifactToolsRoot: string): Promise<void> {
  await admitCachePublication({
    env: process.env,
    diagnosticImpure: getFlagBool("impure"),
    artifactToolsRoot,
  });
  const to = getFlagStr("to", "");
  const manifestOut = getFlagStr("manifest-out", "buck-out/tmp/wheelhouse-cache-manifest.json");
  const source = await chooseRunnableFlakeRef({
    workspaceRoot: process.cwd(),
    sourceMode: "git",
    attr: "graph-generator",
    purpose: "cache-publication",
    artifactToolsRoot,
  });
  const flakeBase = source.flakeRef.replace(/#.*$/, "");
  try {
    const system = await readArtifactSystem(process.cwd(), process.env, artifactToolsRoot);
    const immutableSourceRoot = requiredImmutableSourceRoot(source.workspaceRoot);
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
    const pathsOut = await runArtifactNix({
      args: ["path-info", ...refs],
      workspaceRoot: process.cwd(),
      artifactToolsRoot,
    });
    const outputPaths = Object.fromEntries(
      attrs.map((attr) => [
        attr,
        String(pathsOut.stdout || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean),
      ]),
    );
    const archiveOut = await runArtifactNix({
      args: ["flake", "archive", "--json", flakeBase],
      workspaceRoot: process.cwd(),
      artifactToolsRoot,
    });
    const nixVersion = await runArtifactTool({
      tool: "nix",
      args: ["--version"],
      workspaceRoot: process.cwd(),
      artifactToolsRoot,
    });
    const nodeVersion = await runArtifactTool({
      tool: "node",
      args: ["--version"],
      workspaceRoot: process.cwd(),
      artifactToolsRoot,
    });
    const manifest = buildCacheManifest({
      system,
      sourceRevision: source.bundleDigest,
      flakeLockText: await readImmutableFlakeLock(immutableSourceRoot),
      attrs,
      outputPaths,
      flakeArchiveJson: JSON.parse(String(archiveOut.stdout || "{}")),
      cacheEndpoint: to,
      backend: to ? "nix-copy" : "none",
      toolVersions: {
        nix: String(nixVersion.stdout || "").trim(),
        node: String(nodeVersion.stdout || "").trim(),
      },
      declaredRemoteExecutables: [],
    });
    await mkdirWithMacosMetadataExclusion(path.dirname(manifestOut));
    writeManifest(manifestOut, manifest);
    if (to && to.trim() !== "") {
      const command = renderPublisherCommand(manifest, to);
      if (command.length > 0) {
        await runArtifactTool({
          tool: command[0]!,
          args: command.slice(1),
          workspaceRoot: process.cwd(),
          artifactToolsRoot,
        });
        console.log(
          `wheelhouse-preload: pushed ${keys.length} outputs to ${manifest.cacheEndpointIdentity}`,
        );
      }
    } else {
      console.log("wheelhouse-preload: cache destination not provided; built locally only");
    }
  } finally {
    await source.cleanup?.();
  }
}

function requiredImmutableSourceRoot(workspaceRoot: string | undefined): string {
  if (!workspaceRoot || !workspaceRoot.startsWith("/nix/store/")) {
    throw new Error("cache publication requires an immutable evaluation-bundle source root");
  }
  return workspaceRoot;
}

async function readImmutableFlakeLock(sourceRoot: string): Promise<string> {
  for (const relative of ["flake.lock", ".viberoots/workspace/flake.lock"]) {
    const value = await fsp.readFile(path.join(sourceRoot, relative), "utf8").catch(() => "");
    if (value) return value;
  }
  throw new Error("immutable evaluation-bundle source is missing flake.lock");
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
