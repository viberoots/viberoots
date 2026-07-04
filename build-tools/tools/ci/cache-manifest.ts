import crypto from "node:crypto";
import fs from "node:fs";
import type { SourcePlanEvidence } from "../lib/source-plan-evidence";

export type CacheBackendKind = "none" | "nix-copy" | "attic" | "cachix";

export type CacheManifestInput = {
  system: string;
  sourceRevision: string;
  flakeLockText: string;
  attrs: string[];
  outputPaths: Record<string, string[]>;
  flakeArchiveJson: unknown;
  cacheEndpoint: string;
  backend: CacheBackendKind;
  toolVersions: Record<string, string>;
  declaredRemoteExecutables?: string[];
  selectedGraphOutputs?: string[];
  selectedTargetOutputs?: string[];
  sourcePlans?: SourcePlanEvidence[];
};

export type CacheManifest = {
  schemaVersion: 1;
  system: string;
  sourceRevision: string;
  flakeLockHash: string;
  attrs: { name: string; outputPaths: string[] }[];
  flakeArchivePaths: string[];
  cacheEndpointIdentity: string;
  backend: CacheBackendKind;
  toolVersions: Record<string, string>;
  declaredRemoteExecutables: string[];
  selectedGraphOutputs: string[];
  selectedTargetOutputs: string[];
  sourcePlans: SourcePlanEvidence[];
};

export const DEFAULT_CACHE_ATTRS = [
  ".#graph-generator",
  ".#buck2-prelude",
  ".#test-seed",
  ".#remote-worker-tools",
  ".#toolchains.go",
  ".#toolchains.cxx",
  ".#toolchains.python",
];

const SECRET_PATTERN = /(token|secret|password|private[_-]?key|bearer\s+[a-z0-9._-]+)/i;
const BACKEND_EXECUTABLES: Record<Exclude<CacheBackendKind, "none" | "nix-copy">, string> = {
  attic: "attic",
  cachix: "cachix",
};

export function buildCacheManifest(input: CacheManifestInput): CacheManifest {
  const attrs = unique(input.attrs).map((name) => ({
    name,
    outputPaths: requiredOutputPaths(name, input.outputPaths[name]),
  }));
  for (const entry of attrs) {
    for (const out of entry.outputPaths) assertStorePath(out);
  }
  const selectedGraphOutputs = checkedStorePaths(input.selectedGraphOutputs || []);
  const selectedTargetOutputs = checkedStorePaths(input.selectedTargetOutputs || []);
  return {
    schemaVersion: 1,
    system: input.system,
    sourceRevision: input.sourceRevision,
    flakeLockHash: sha256(input.flakeLockText),
    attrs,
    flakeArchivePaths: flakeArchivePaths(input.flakeArchiveJson),
    cacheEndpointIdentity: endpointIdentity(input.cacheEndpoint),
    backend: input.backend,
    toolVersions: input.toolVersions,
    declaredRemoteExecutables: unique(input.declaredRemoteExecutables || []),
    selectedGraphOutputs,
    selectedTargetOutputs,
    sourcePlans: normalizeSourcePlans(input.sourcePlans || []),
  };
}

export function manifestStorePaths(manifest: CacheManifest): string[] {
  return unique([
    ...manifest.flakeArchivePaths,
    ...manifest.attrs.flatMap((entry) => entry.outputPaths),
    ...manifest.selectedGraphOutputs,
    ...manifest.selectedTargetOutputs,
  ]);
}

export function renderPublisherCommand(manifest: CacheManifest, destination: string): string[] {
  assertNoSecret("cache destination", destination);
  const paths = manifestStorePaths(manifest);
  if (manifest.backend === "none") return [];
  if (manifest.backend === "nix-copy") return ["nix", "copy", "--to", destination, ...paths];
  if (manifest.backend === "attic" || manifest.backend === "cachix") {
    const executable = BACKEND_EXECUTABLES[manifest.backend];
    if (!manifest.declaredRemoteExecutables.includes(executable)) {
      throw new Error(`${executable} backend requires ${executable} in remote-ci-tools closure`);
    }
    return [executable, "push", destination, ...paths];
  }
  return [];
}

export function discoverCacheAttrs(packageNames: string[]): string[] {
  return unique([
    ...DEFAULT_CACHE_ATTRS,
    ...packageNames.filter((name) => name.startsWith("py-wheelhouse-")).map((name) => `.#${name}`),
    ...packageNames.filter((name) => name.startsWith("node-modules")).map((name) => `.#${name}`),
  ]);
}

export function discoverWheelhouseCacheAttrs(packageNames: string[]): string[] {
  return unique(
    packageNames.filter((name) => name.startsWith("py-wheelhouse-")).map((name) => `.#${name}`),
  );
}

export function remoteCiToolsPathEnv(
  remoteCiTools: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!remoteCiTools) return baseEnv;
  assertStorePath(remoteCiTools);
  return {
    ...baseEnv,
    PATH: `${remoteCiTools}/bin`,
  };
}

export function writeManifest(path: string, manifest: CacheManifest): void {
  fs.writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function flakeArchivePaths(value: unknown): string[] {
  const paths: string[] = [];
  collectArchivePaths(value, paths);
  return unique(paths);
}

function collectArchivePaths(value: unknown, paths: string[]): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.path === "string") {
    assertStorePath(record.path);
    paths.push(record.path);
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectArchivePaths(child, paths);
  }
}

function endpointIdentity(endpoint: string): string {
  if (!endpoint) return "dry-run";
  const sanitized = endpoint.replace(/\/\/[^/@]+@/, "//<redacted>@").replace(/\?.*$/, "");
  assertNoSecret("cache endpoint identity", sanitized);
  return `${sanitized}#${sha256(sanitized).slice(0, 12)}`;
}

function assertNoSecret(field: string, value: string): void {
  if (SECRET_PATTERN.test(value)) throw new Error(`${field} must not contain credential material`);
}

function assertStorePath(value: string): void {
  if (!value.startsWith("/nix/store/")) throw new Error(`expected Nix store path: ${value}`);
  assertNoSecret("store path", value);
}

function checkedStorePaths(values: string[]): string[] {
  for (const value of values) assertStorePath(value);
  return values;
}

function requiredOutputPaths(attr: string, values: string[] | undefined): string[] {
  const paths = values || [];
  if (!paths.length) throw new Error(`missing output paths for configured attr ${attr}`);
  return paths;
}

function normalizeSourcePlans(sourcePlans: SourcePlanEvidence[]): SourcePlanEvidence[] {
  const byTarget = new Map<string, SourcePlanEvidence>();
  for (const plan of sourcePlans) {
    if (!plan.target) continue;
    byTarget.set(plan.target, {
      target: plan.target,
      nixpkgs_profile: plan.nixpkgs_profile || "default",
      nixpkg_pins: Object.fromEntries(
        Object.entries(plan.nixpkg_pins || {}).map(([attr, pin]) => [
          attr,
          { nixpkgs_profile: pin.nixpkgs_profile || "default" },
        ]),
      ),
    });
  }
  return [...byTarget.values()].sort((a, b) => a.target.localeCompare(b.target));
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
