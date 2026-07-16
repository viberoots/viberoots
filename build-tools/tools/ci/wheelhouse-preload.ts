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

export async function runWheelhousePreload(): Promise<void> {
  await admitCachePublication({ env: process.env, diagnosticImpure: getFlagBool("impure") });
  const to = getFlagStr("to", process.env.NIX_CACHE_TO || "");
  const manifestOut = getFlagStr("manifest-out", "buck-out/tmp/wheelhouse-cache-manifest.json");
  const system = await currentSystem();
  if (!system) {
    console.warn("wheelhouse-preload: could not determine current system; skipping");
    return;
  }
  const keys = await packageKeys(system);
  const attrs = discoverWheelhouseCacheAttrs(keys);
  if (!attrs.length) {
    console.log("wheelhouse-preload: no wheelhouse outputs found; nothing to do");
    return;
  }
  const attrArgs = attrs.join(" ");
  await $`bash --noprofile --norc -c ${`set -euo pipefail; nix build --impure --accept-flake-config --no-link --print-out-paths ${attrArgs}`}`;
  const pathsOut =
    await $`bash --noprofile --norc -c ${`set -euo pipefail; nix path-info ${attrArgs}`}`;
  const outputPaths = Object.fromEntries(
    attrs.map((attr) => [
      attr,
      String(pathsOut.stdout || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    ]),
  );
  const archiveOut = await $`nix flake archive --json .`;
  const sourceRev = await $`git rev-parse HEAD`.nothrow();
  const nixVersion = await $`nix --version`.nothrow();
  const nodeVersion = await $`node --version`.nothrow();
  const manifest = buildCacheManifest({
    system,
    sourceRevision: sourceRev.exitCode === 0 ? String(sourceRev.stdout).trim() : "unknown",
    flakeLockText: await fsp.readFile("flake.lock", "utf8"),
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
      await $`${command}`;
      console.log(`wheelhouse-preload: pushed ${keys.length} outputs to ${to}`);
    }
  } else {
    console.log("wheelhouse-preload: cache destination not provided; built locally only");
  }
}

async function currentSystem(): Promise<string> {
  const sysOut = await $`nix eval --raw --impure --expr builtins.currentSystem`.nothrow();
  return String(sysOut.stdout || "").trim();
}

async function packageKeys(system: string): Promise<string[]> {
  const evalOut =
    await $`nix eval --json --impure --accept-flake-config .#packages.${system}`.nothrow();
  if (evalOut.exitCode !== 0) return [];
  try {
    return Object.keys(JSON.parse(String(evalOut.stdout || "{}")) || {});
  } catch {
    return [];
  }
}
