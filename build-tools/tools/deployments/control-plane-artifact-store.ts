#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { sanitizeName } from "../lib/sanitize";
import { materializeStaticWebappArtifactBundle } from "./static-webapp-artifact-bundle";
import { createS3CompatibleArtifactStore } from "./control-plane-artifact-store-http";
import type { ControlPlaneRuntimeConfig } from "./control-plane-runtime-config-types";
import type {
  ControlPlaneArtifactObject,
  ControlPlaneArtifactStore,
} from "./control-plane-artifact-store-types";

export const CONTROL_PLANE_ARTIFACT_CONTENT_TYPE =
  "application/vnd.viberoots.deployment-artifact-bundle+json";

export function artifactPayloadDigest(bytes: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function objectKeyForDigest(payloadKind: string, digest: string): string {
  const hex = digest.replace(/^sha256:/, "");
  return `control-plane/${payloadKind}/sha256/${hex}`;
}

export function artifactObjectReferenceUrl(object: ControlPlaneArtifactObject): string {
  return `artifact-object://${object.bucket}/${object.key}`;
}

function cleanProvenance(provenance: ControlPlaneArtifactObject["provenance"]) {
  const entries = Object.entries(provenance)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function provenanceDigest(provenance: ControlPlaneArtifactObject["provenance"]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(cleanProvenance(provenance)))
    .digest("hex");
}

function objectKeyForPayload(
  payloadKind: ControlPlaneArtifactObject["provenance"]["payloadKind"],
  digest: string,
  provenance: ControlPlaneArtifactObject["provenance"],
): string {
  const hex = digest.replace(/^sha256:/, "");
  return `control-plane/${payloadKind}/sha256/${hex}/provenance/${provenanceDigest(provenance)}`;
}

function artifactObjectMetadata(object: ControlPlaneArtifactObject): Record<string, string> {
  return {
    digest: object.digest,
    size: String(object.size),
    payload_kind: object.provenance.payloadKind,
    provenance_json: JSON.stringify(cleanProvenance(object.provenance)),
  };
}

function assertStoredMetadata(
  object: ControlPlaneArtifactObject,
  stored: { contentType?: string; metadata: Record<string, string> },
) {
  if (stored.contentType && stored.contentType !== object.contentType) {
    throw new Error(`artifact object content-type mismatch for ${object.key}`);
  }
  const expected = artifactObjectMetadata(object);
  for (const [key, value] of Object.entries(expected)) {
    if (stored.metadata[key] !== value) {
      throw new Error(`artifact object ${key} metadata mismatch for ${object.key}`);
    }
  }
}

export async function artifactStoreFromRuntimeConfig(config: ControlPlaneRuntimeConfig) {
  const store = config.storage.artifactStore;
  const readSecret = async (filePath: string) => (await fsp.readFile(filePath, "utf8")).trim();
  return createS3CompatibleArtifactStore({
    endpoint: await readSecret(store.endpointFile),
    bucket: store.bucket,
    region: store.region,
    accessKeyId: await readSecret(store.accessKeyIdFile),
    secretAccessKey: await readSecret(store.secretAccessKeyFile),
  });
}

export function assertProductionArtifactStore(opts: {
  localFixture?: boolean;
  objectStore?: ControlPlaneArtifactStore;
}) {
  if (!opts.localFixture && !opts.objectStore) {
    throw new Error(
      "production control-plane artifact authority requires an S3-compatible object store",
    );
  }
}

export async function putVerifiedArtifactObject(opts: {
  store: ControlPlaneArtifactStore;
  body: Buffer;
  payloadKind: ControlPlaneArtifactObject["provenance"]["payloadKind"];
  contentType?: string;
  provenance?: Omit<ControlPlaneArtifactObject["provenance"], "payloadKind">;
}): Promise<ControlPlaneArtifactObject> {
  const digest = artifactPayloadDigest(opts.body);
  const provenance = { payloadKind: opts.payloadKind, ...opts.provenance };
  const object: ControlPlaneArtifactObject = {
    storeKind: opts.store.kind,
    bucket: opts.store.bucket,
    key: objectKeyForPayload(opts.payloadKind, digest, provenance),
    digest,
    size: opts.body.byteLength,
    contentType: opts.contentType || CONTROL_PLANE_ARTIFACT_CONTENT_TYPE,
    provenance,
  };
  await opts.store.putObject({
    key: object.key,
    body: opts.body,
    contentType: object.contentType,
    metadata: artifactObjectMetadata(object),
  });
  await verifyArtifactObject({ store: opts.store, object });
  return object;
}

export async function readVerifiedArtifactObject(opts: {
  store: ControlPlaneArtifactStore;
  object: ControlPlaneArtifactObject;
}): Promise<Buffer> {
  const bytes = await opts.store.getObject({ key: opts.object.key });
  if (bytes.byteLength !== opts.object.size) {
    throw new Error(`artifact object size mismatch for ${opts.object.key}`);
  }
  const digest = artifactPayloadDigest(bytes);
  if (digest !== opts.object.digest) {
    throw new Error(`artifact object digest mismatch for ${opts.object.key}`);
  }
  return bytes;
}

export async function verifyArtifactObject(opts: {
  store: ControlPlaneArtifactStore;
  object: ControlPlaneArtifactObject;
}) {
  const bytes = await readVerifiedArtifactObject(opts);
  assertStoredMetadata(opts.object, await opts.store.getObjectMetadata({ key: opts.object.key }));
  return bytes;
}

export async function putImmutableArtifactObject(opts: {
  store: ControlPlaneArtifactStore;
  object: ControlPlaneArtifactObject;
  body: Buffer;
}) {
  const digest = artifactPayloadDigest(opts.body);
  if (digest !== opts.object.digest || opts.body.byteLength !== opts.object.size) {
    throw new Error(`artifact object payload conflicts with immutable key ${opts.object.key}`);
  }
  await opts.store.putObject({
    key: opts.object.key,
    body: opts.body,
    contentType: opts.object.contentType,
    metadata: artifactObjectMetadata(opts.object),
  });
  await verifyArtifactObject({ store: opts.store, object: opts.object });
}

export async function materializeArtifactObject(opts: {
  store: ControlPlaneArtifactStore;
  object: ControlPlaneArtifactObject;
  outputRoot: string;
  identity: string;
}) {
  const bytes = await verifyArtifactObject(opts);
  if (opts.object.provenance.artifactIdentity !== opts.identity) {
    throw new Error(`artifact object provenance mismatch for ${opts.identity}`);
  }
  const outputDir = path.join(path.resolve(opts.outputRoot), sanitizeName(opts.identity));
  await materializeStaticWebappArtifactBundle(bytes, outputDir);
  return outputDir;
}
