#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagStr } from "../lib/cli";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import {
  buildCacheManifest,
  discoverCacheAttrs,
  remoteCiToolsPathEnv,
  renderPublisherCommand,
  writeManifest,
  type CacheBackendKind,
} from "./cache-manifest";

type ExtraOutputs = { graph?: string[]; targets?: string[] };

async function main() {
  process.env = remoteCiToolsPathEnv(
    getFlagStr("remote-ci-tools", process.env.VBR_REMOTE_CI_TOOLS || ""),
  );
  const out = getFlagStr("out", "buck-out/tmp/nix-cache-manifest.json");
  const backend = getFlagStr("backend", "none") as CacheBackendKind;
  const destination = getFlagStr("to", process.env.NIX_CACHE_TO || "");
  const dryRun = getFlagBool("dry-run") || backend === "none";
  const packageNames = await packageNamesForCurrentSystem();
  const selectedGraphAttrs = getRepeatedFlag("selected-graph-attr");
  const selectedTargetAttrs = getRepeatedFlag("selected-target-attr");
  const attrs = [
    ...discoverCacheAttrs(packageNames),
    ...selectedGraphAttrs,
    ...selectedTargetAttrs,
  ];
  const extra = await readExtraOutputs(getFlagStr("selected-outputs"));
  const outputPaths = await buildAttrs(attrs);
  const flakeLockText = await fs.readFile("flake.lock", "utf8");
  const manifest = buildCacheManifest({
    system: await readCurrentSystem(),
    sourceRevision: await readSourceRevision(),
    flakeLockText,
    attrs,
    outputPaths,
    flakeArchiveJson: await readJson($`nix flake archive --json .`),
    cacheEndpoint: destination,
    backend,
    toolVersions: await toolVersions(),
    declaredRemoteExecutables: await readDeclaredRemoteExecutables(),
    selectedGraphOutputs: [
      ...selectedGraphAttrs.flatMap((attr) => outputPaths[attr] || []),
      ...(extra.graph || []),
    ],
    selectedTargetOutputs: [
      ...selectedTargetAttrs.flatMap((attr) => outputPaths[attr] || []),
      ...(extra.targets || []),
    ],
  });
  await mkdirWithMacosMetadataExclusion(path.dirname(out));
  writeManifest(out, manifest);
  const command = renderPublisherCommand(manifest, destination);
  console.log(JSON.stringify({ manifest: out, attrs: attrs.length, dryRun, command }, null, 2));
  if (!dryRun && command.length) await $`${command}`;
}

async function packageNamesForCurrentSystem(): Promise<string[]> {
  const system = await readCurrentSystem();
  const res =
    await $`nix eval --json --impure --accept-flake-config .#packages.${system}`.nothrow();
  if (res.exitCode !== 0) return [];
  return Object.keys(JSON.parse(String(res.stdout || "{}")));
}

async function readCurrentSystem(): Promise<string> {
  const res = await $`nix eval --raw --impure --expr builtins.currentSystem`;
  return String(res.stdout).trim();
}

async function readSourceRevision(): Promise<string> {
  const res = await $`git rev-parse HEAD`.nothrow();
  return res.exitCode === 0 ? String(res.stdout).trim() : "unknown";
}

async function buildAttrs(attrs: string[]): Promise<Record<string, string[]>> {
  const outputs: Record<string, string[]> = {};
  for (const attr of attrs) {
    const res = await $`nix build ${attr} --no-link --print-out-paths --accept-flake-config`;
    const paths = String(res.stdout).trim().split(/\s+/).filter(Boolean);
    if (!paths.length) {
      throw new Error(`nix build produced no output path for ${attr}`);
    }
    outputs[attr] = paths;
  }
  return outputs;
}

async function readJson(proc: ProcessPromise): Promise<unknown> {
  const res = await proc;
  return JSON.parse(String(res.stdout || "{}"));
}

async function readExtraOutputs(file: string): Promise<ExtraOutputs> {
  if (!file) return {};
  return JSON.parse(await fs.readFile(file, "utf8")) as ExtraOutputs;
}

async function toolVersions(): Promise<Record<string, string>> {
  const nix = await $`nix --version`.nothrow();
  const node = await $`node --version`.nothrow();
  return { nix: String(nix.stdout).trim(), node: String(node.stdout).trim() };
}

async function readDeclaredRemoteExecutables(): Promise<string[]> {
  const text = await fs
    .readFile("build-tools/tools/nix/flake/packages/remote-worker-tools.nix", "utf8")
    .catch(() => "");
  const block = /declaredRemoteExecutablePackages\s*=\s*\{([\s\S]*?)\};/.exec(text)?.[1] || "";
  return [...block.matchAll(/\b([A-Za-z0-9_-]+)\s*=/g)].map((match) => match[1]);
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
