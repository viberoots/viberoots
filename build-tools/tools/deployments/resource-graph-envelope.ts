#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import { readDeploymentResourceInventory } from "./resource-graph-inventory";
import { inventoryRefErrors } from "./resource-graph-envelope-validation";
import { ADMITTED_RUNTIME_SOURCE_LABEL } from "./resource-graph-types";
import type {
  DeploymentResourceInventory,
  DeploymentResourceInventoryEntry,
  DeploymentResourceInventoryOptions,
} from "./resource-graph-types";

export const DEPLOYMENT_RESOURCE_ENVELOPE_API_VERSION = "deployment.resource.viberoots.dev/v1";

export type DeploymentResourceOwnerReference = {
  apiVersion: typeof DEPLOYMENT_RESOURCE_ENVELOPE_API_VERSION;
  kind: DeploymentResourceInventoryEntry["kind"];
  name: string;
  uid: string;
};

export type DeploymentResourceEnvelope = {
  apiVersion: typeof DEPLOYMENT_RESOURCE_ENVELOPE_API_VERSION;
  kind: DeploymentResourceInventoryEntry["kind"];
  metadata: {
    name: string;
    uid: string;
    labels: Record<string, string>;
    ownerReferences: DeploymentResourceOwnerReference[];
  };
  spec: Record<string, unknown>;
  statusRef: string;
  evidenceRef?: string;
  policyRefs: string[];
  source: DeploymentResourceInventoryEntry["source"];
};

export type DeploymentResourceEnvelopeSet = {
  apiVersion: "deployment-resource-envelope-list@1";
  inventory: DeploymentResourceInventory;
  envelopes: DeploymentResourceEnvelope[];
  errors: string[];
};

export async function readDeploymentResourceEnvelopes(
  opts: DeploymentResourceInventoryOptions = {},
) {
  return createDeploymentResourceEnvelopes(await readDeploymentResourceInventory(opts));
}

export function createDeploymentResourceEnvelopes(inventory: DeploymentResourceInventory) {
  const uidByKey = new Map(
    inventory.resources.map((resource) => [resourceKey(resource), resourceUid(resource)]),
  );
  const refsById = refsIndex(inventory.resources, uidByKey);
  const envelopes = inventory.resources.map((resource) =>
    envelopeForResource(resource, uidByKey, refsById),
  );
  return {
    apiVersion: "deployment-resource-envelope-list@1",
    inventory,
    envelopes,
    errors: [
      ...inventory.errors,
      ...inventoryRefErrors(inventory.resources),
      ...rawSecretSourceErrors(inventory.resources),
      ...sourceAuthorityErrors(envelopes),
      ...secretSafetyErrors(envelopes),
    ],
  };
}

function envelopeForResource(
  resource: DeploymentResourceInventoryEntry,
  uidByKey: Map<string, string>,
  refsById: Map<string, DeploymentResourceOwnerReference[]>,
): DeploymentResourceEnvelope {
  const uid = uidByKey.get(resourceKey(resource)) || resourceUid(resource);
  const refs = resource.refs || [];
  return {
    apiVersion: DEPLOYMENT_RESOURCE_ENVELOPE_API_VERSION,
    kind: resource.kind,
    metadata: {
      name: resource.id,
      uid,
      labels: {
        "viberoots.dev/authority": resource.authority,
        "viberoots.dev/source-class": resource.source.class,
      },
      ownerReferences: ownerReferences(refs, refsById, uid),
    },
    spec: redactSecrets(resource.facts || {}) as Record<string, unknown>,
    statusRef: `status:${uid}`,
    evidenceRef: resource.authority === "observed_runtime" ? `evidence:${uid}` : undefined,
    policyRefs: policyRefs(refs, refsById),
    source: resource.source,
  };
}

function ownerReferences(
  refs: string[],
  refsById: Map<string, DeploymentResourceOwnerReference[]>,
  selfUid: string,
): DeploymentResourceOwnerReference[] {
  return refs.flatMap((ref) => refsById.get(ref) || []).filter((ref) => ref.uid !== selfUid);
}

function policyRefs(
  refs: string[],
  refsById: Map<string, DeploymentResourceOwnerReference[]>,
): string[] {
  return refs
    .flatMap((ref) => refsById.get(ref) || [])
    .filter((ref) => ref.kind.endsWith("Policy"))
    .map((ref) => ref.uid)
    .sort();
}

function refsIndex(
  resources: DeploymentResourceInventoryEntry[],
  uidByKey: Map<string, string>,
): Map<string, DeploymentResourceOwnerReference[]> {
  const out = new Map<string, DeploymentResourceOwnerReference[]>();
  for (const resource of resources) {
    const ref = {
      apiVersion: DEPLOYMENT_RESOURCE_ENVELOPE_API_VERSION,
      kind: resource.kind,
      name: resource.id,
      uid: uidByKey.get(resourceKey(resource)) || resourceUid(resource),
    };
    out.set(resource.id, [...(out.get(resource.id) || []), ref]);
  }
  return out;
}

function resourceUid(resource: DeploymentResourceInventoryEntry): string {
  return `uid:deployment-resource:${resource.kind}:${hash(stableIdentityInput(resource))}`;
}

function stableIdentityInput(resource: DeploymentResourceInventoryEntry): Record<string, unknown> {
  return {
    kind: resource.kind,
    id: resource.id,
    authority: resource.authority,
    source: { class: resource.source.class, label: resource.source.label },
    refs: resource.refs || [],
    facts: resource.facts || {},
  };
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 32);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resourceKey(resource: DeploymentResourceInventoryEntry): string {
  return `${resource.kind}\0${resource.id}`;
}

function secretSafetyErrors(envelopes: DeploymentResourceEnvelope[]): string[] {
  return envelopes.flatMap((envelope) =>
    secretPaths(envelope.spec).map(
      (path) => `${envelope.kind} ${envelope.metadata.name}: envelope exposes forbidden ${path}`,
    ),
  );
}

function rawSecretSourceErrors(resources: DeploymentResourceInventoryEntry[]): string[] {
  return resources.flatMap((resource) =>
    secretPaths(resource.facts || {}, "spec", isRejectableSecretKey).map(
      (path) => `${resource.kind} ${resource.id}: envelope exposes forbidden ${path}`,
    ),
  );
}

function sourceAuthorityErrors(envelopes: DeploymentResourceEnvelope[]): string[] {
  return envelopes
    .filter(
      (envelope) =>
        envelope.metadata.labels["viberoots.dev/authority"] === "observed_runtime" &&
        (envelope.source.class !== "runtime" ||
          envelope.source.label !== ADMITTED_RUNTIME_SOURCE_LABEL),
    )
    .map(
      (envelope) =>
        `${envelope.kind} ${envelope.metadata.name}: runtime envelope must derive from admitted runtime records`,
    );
}
const REDACTED_SECRET = "<redacted>";

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isForbiddenSecretKey(key) ? REDACTED_SECRET : redactSecrets(item),
    ]),
  );
}

function secretPaths(
  value: unknown,
  path = "spec",
  rejectKey: (key: string) => boolean = isForbiddenSecretKey,
): string[] {
  if (Array.isArray(value))
    return value.flatMap((item, index) => secretPaths(item, `${path}[${index}]`, rejectKey));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const next = `${path}.${key}`;
    if (rejectKey(key) && item !== REDACTED_SECRET) return [next];
    return secretPaths(item, next, rejectKey);
  });
}

function isRejectableSecretKey(key: string): boolean {
  return isForbiddenSecretKey(key) && !["proof", "nonce"].includes(key.toLowerCase());
}

function isForbiddenSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (["token", "rawtoken", "raw_token", "secret", "proof", "nonce"].includes(lower)) return true;
  return /(password|credential)$/i.test(key);
}
