import {
  parseRemoteBuilderEndpoint,
  type RemoteBuilderEndpoint,
} from "./remote-builder-ssh-authority";
import { RELEASE_BUILDER_SYSTEMS } from "../lib/artifact-reproducibility-matrix";
export {
  installReviewedSshHostAuthority,
  installReviewedSshTransportAuthority,
  parseRemoteBuilderEndpoint,
  parseRemoteBuilderTransportFile,
  type RemoteBuilderEndpoint,
  type RemoteBuilderTransport,
} from "./remote-builder-ssh-authority";

export type ReviewedRemoteBuilder = {
  identity: `reviewed:${string}`;
  endpoint: RemoteBuilderEndpoint;
  supportedSystem: "aarch64-darwin" | "aarch64-linux" | "x86_64-linux";
  policyStorePath: string;
  probeFlakeStorePath: string;
};

export type ReviewedRemoteBuilderRegistry = {
  schema: "viberoots.reviewed-remote-builders.v3";
  evidenceStore: {
    schema: "viberoots.reproducibility-evidence-store.v1";
    storeUri: string;
    signatures: "required";
  };
  builders: ReviewedRemoteBuilder[];
};

export function assertReleaseRemoteBuilderCoverage(registry: ReviewedRemoteBuilderRegistry): void {
  const expected = RELEASE_BUILDER_SYSTEMS.length * 2;
  if (registry.builders.length !== expected) {
    throw new Error(`release registry requires exactly ${expected} reviewed builders`);
  }
  for (const system of RELEASE_BUILDER_SYSTEMS) {
    const count = registry.builders.filter((builder) => builder.supportedSystem === system).length;
    if (count !== 2) {
      throw new Error(`release registry requires exactly two reviewed builders for ${system}`);
    }
  }
}

export function assertIndependentReviewedRemoteBuilders(
  left: ReviewedRemoteBuilder,
  right: ReviewedRemoteBuilder,
): void {
  const leftEndpoint = left.endpoint;
  const rightEndpoint = right.endpoint;
  const sameEndpoint =
    leftEndpoint.protocol === rightEndpoint.protocol &&
    leftEndpoint.host === rightEndpoint.host &&
    leftEndpoint.port === rightEndpoint.port &&
    leftEndpoint.user === rightEndpoint.user;
  const sameHostKey =
    leftEndpoint.hostKey.algorithm === rightEndpoint.hostKey.algorithm &&
    leftEndpoint.hostKey.publicKey === rightEndpoint.hostKey.publicKey &&
    leftEndpoint.hostKey.fingerprint === rightEndpoint.hostKey.fingerprint;
  if (sameEndpoint || sameHostKey) {
    throw new Error(
      `reviewed builder identities share one remote daemon authority: ${left.identity}, ${right.identity}`,
    );
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: string[], name: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    throw new Error(`${name} has invalid fields: ${actual.join(", ")}`);
  }
}

export function parseReviewedRemoteBuilders(value: unknown): ReviewedRemoteBuilderRegistry {
  const registry = record(value, "reviewed remote-builder registry");
  exact(registry, ["builders", "evidenceStore", "schema"], "reviewed remote-builder registry");
  if (
    registry.schema !== "viberoots.reviewed-remote-builders.v3" ||
    !Array.isArray(registry.builders)
  ) {
    throw new Error("reviewed remote-builder registry requires v3");
  }
  const evidenceStore = record(registry.evidenceStore, "reviewed reproducibility evidence store");
  exact(
    evidenceStore,
    ["schema", "signatures", "storeUri"],
    "reviewed reproducibility evidence store",
  );
  const storeUri = String(evidenceStore.storeUri || "");
  let parsedStore: URL;
  try {
    parsedStore = new URL(storeUri);
  } catch {
    throw new Error("reviewed reproducibility evidence store URI is invalid");
  }
  if (
    evidenceStore.schema !== "viberoots.reproducibility-evidence-store.v1" ||
    evidenceStore.signatures !== "required" ||
    parsedStore.protocol !== "s3:" ||
    !parsedStore.hostname ||
    parsedStore.username ||
    parsedStore.password ||
    parsedStore.search ||
    parsedStore.hash
  ) {
    throw new Error("reviewed reproducibility evidence store must be credential-free signed S3");
  }
  const builders = registry.builders.map((raw, index) => {
    const entry = record(raw, `reviewed builder ${index}`);
    exact(
      entry,
      ["endpoint", "identity", "policyStorePath", "probeFlakeStorePath", "supportedSystem"],
      `reviewed builder ${index}`,
    );
    const identity = String(entry.identity || "");
    if (!/^reviewed:[a-z0-9][a-z0-9._-]*$/u.test(identity))
      throw new Error("reviewed builder identity is invalid");
    const supportedSystem = String(entry.supportedSystem || "");
    if (!["aarch64-darwin", "aarch64-linux", "x86_64-linux"].includes(supportedSystem)) {
      throw new Error("reviewed builder supportedSystem is invalid");
    }
    for (const [name, value] of [
      ["policyStorePath", entry.policyStorePath],
      ["probeFlakeStorePath", entry.probeFlakeStorePath],
    ] as const) {
      if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+(?:\/[^/]+)?$/u.test(String(value || "")))
        throw new Error(`reviewed builder ${name} is not immutable`);
    }
    return {
      identity: identity as `reviewed:${string}`,
      endpoint: parseRemoteBuilderEndpoint(entry.endpoint),
      supportedSystem: supportedSystem as ReviewedRemoteBuilder["supportedSystem"],
      policyStorePath: String(entry.policyStorePath),
      probeFlakeStorePath: String(entry.probeFlakeStorePath),
    };
  });
  const sorted = [...builders].sort((a, b) => a.identity.localeCompare(b.identity));
  if (
    JSON.stringify(builders) !== JSON.stringify(sorted) ||
    new Set(builders.map(({ identity }) => identity)).size !== builders.length
  ) {
    throw new Error("reviewed remote-builder registry must be uniquely identity-sorted");
  }
  for (let left = 0; left < builders.length; left += 1) {
    for (let right = left + 1; right < builders.length; right += 1) {
      assertIndependentReviewedRemoteBuilders(builders[left]!, builders[right]!);
    }
  }
  return {
    schema: registry.schema,
    evidenceStore: {
      schema: evidenceStore.schema,
      storeUri,
      signatures: evidenceStore.signatures,
    },
    builders,
  };
}

export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, sort(child)]),
          )
        : item;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
