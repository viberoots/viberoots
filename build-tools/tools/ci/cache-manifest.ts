import crypto from "node:crypto";
import fs from "node:fs";
export { remoteCiToolsPathEnv } from "../remote-exec/nix-remote-builder-environment";
import {
  assertCachePublicationEvidence,
  systemReproducibilityOutputs,
  type SignedArtifactReproducibilityAggregate,
} from "./cache-publication-evidence";

export type CacheBackendKind = "none" | "nix-copy" | "attic" | "cachix";

export type CacheManifestInput = {
  system: string;
  cacheEndpoint: string;
  backend: CacheBackendKind;
  declaredRemoteExecutables?: string[];
  reproducibilityAggregate: SignedArtifactReproducibilityAggregate;
};

export type CacheManifest = {
  schemaVersion: 3;
  system: string;
  sourceRevision: string;
  attrs: { name: string; outputPaths: string[] }[];
  cacheEndpointIdentity: string;
  backend: CacheBackendKind;
  declaredRemoteExecutables: string[];
  reproducibilityAggregateStorePath: string;
};

const SECRET_PATTERN = /(token|secret|password|private[_-]?key|bearer\s+[a-z0-9._-]+)/i;
const BACKEND_EXECUTABLES: Record<Exclude<CacheBackendKind, "none" | "nix-copy">, string> = {
  attic: "attic",
  cachix: "cachix",
};

export function buildCacheManifest(input: CacheManifestInput): CacheManifest {
  const attrs = systemReproducibilityOutputs(input.reproducibilityAggregate, input.system).map(
    ({ subjectId, outputPath }) => ({
      name: `publication:${subjectId}`,
      outputPaths: [checkedStorePath(outputPath)],
    }),
  );
  return {
    schemaVersion: 3,
    system: input.system,
    sourceRevision: input.reproducibilityAggregate.aggregate.sourceRevision,
    attrs,
    cacheEndpointIdentity: endpointIdentity(input.cacheEndpoint),
    backend: input.backend,
    declaredRemoteExecutables: unique(input.declaredRemoteExecutables || []),
    reproducibilityAggregateStorePath: input.reproducibilityAggregate.storePath,
  };
}

export function manifestStorePaths(manifest: CacheManifest): string[] {
  return unique([
    ...manifest.attrs.flatMap((entry) => entry.outputPaths),
    aggregateStoreRoot(manifest.reproducibilityAggregateStorePath),
  ]);
}

export function renderPublisherCommand(
  manifest: CacheManifest,
  destination: string,
  aggregate?: SignedArtifactReproducibilityAggregate,
): string[] {
  assertCacheDestination(destination);
  assertCachePublicationEvidence(manifest, aggregate);
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

export function writeManifest(file: string, manifest: CacheManifest): void {
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function aggregateStoreRoot(file: string): string {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/aggregate\.json$/u.test(file)) {
    throw new Error("cache manifest reproducibility aggregate path is invalid");
  }
  return path.dirname(file);
}

function assertCacheDestination(destination: string): void {
  assertNoSecret("cache destination", destination);
  if (!destination) return;
  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    return;
  }
  if (parsed.password) throw new Error("cache destination must not contain credential material");
  for (const key of parsed.searchParams.keys()) {
    if (/(?:auth|credential|password|secret|signature|token|access[-_]?key)/iu.test(key)) {
      throw new Error("cache destination must not contain credential material");
    }
  }
}

function endpointIdentity(endpoint: string): string {
  if (!endpoint) return "dry-run";
  const sanitized = endpoint.replace(/\/\/[^/@]+@/, "//<redacted>@").replace(/\?.*$/, "");
  assertNoSecret("cache endpoint identity", sanitized);
  const digest = crypto.createHash("sha256").update(sanitized).digest("hex").slice(0, 12);
  return `${sanitized}#${digest}`;
}

function assertNoSecret(field: string, value: string): void {
  if (SECRET_PATTERN.test(value)) throw new Error(`${field} must not contain credential material`);
}

function checkedStorePath(value: string): string {
  assertStorePath(value);
  return value;
}

function assertStorePath(value: string): void {
  if (!value.startsWith("/nix/store/")) throw new Error(`expected Nix store path: ${value}`);
  assertNoSecret("store path", value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
