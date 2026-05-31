import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli";
import { validateCredentialMap, type CredentialMap } from "./cloud-control-credential-map";
import { parseControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import {
  CREDENTIAL_MOUNT_TARGET,
  CREDENTIAL_ROTATION_SCHEMA,
  CREDENTIAL_STAGING_SCHEMA,
  type CredentialRotationEvidence,
  type CredentialStagingEvidence,
  type LiveBackendWriteEvidence,
} from "./control-plane-credential-staging-types";
import { digestCredentialInput } from "./control-plane-credential-staging-evidence";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";
import { rotateCredentialMap } from "./control-plane-credential-rotation";
import {
  hostMountEvidence,
  liveRequested,
  type LiveHostMountInput,
  validateLiveInputs,
} from "./control-plane-credential-staging-live";
import {
  backendRefs,
  hostSourceIds,
  reloadEvidence,
  requiredFiles,
  staleDetection,
  writePlanIds,
} from "./control-plane-credential-staging-helpers";

type Manifest = {
  credentialDirectory?: string;
  reviewedSourceMode?: string;
  requiredFiles?: string[];
};

type Inputs = {
  manifest: Manifest;
  credentialMap: CredentialMap;
  configText: string;
  supabaseProfile?: SupabaseManagedPostgresProfile;
  liveBackendWriteEvidence?: LiveBackendWriteEvidence;
  liveHostMountEvidence?: LiveHostMountInput;
};

export async function runCredentialStagingCommand(): Promise<void> {
  const result = await runCredentialStaging({
    bundleDir: getFlagStr("bundle-dir", ".").trim(),
    out: getFlagStr("out", "").trim(),
    live: liveRequested(),
    secretBackendEvidence: getFlagStr("secret-backend-evidence", "").trim(),
    hostMountEvidence: getFlagStr("host-mount-evidence", "").trim(),
  });
  emitResult(result, getFlagStr("out", "").trim());
  if (!result.ok) process.exitCode = 2;
}

export async function runCredentialRotationCommand(): Promise<void> {
  const result = await runCredentialRotation({
    bundleDir: getFlagStr("bundle-dir", ".").trim(),
    out: getFlagStr("out", "").trim(),
    staleCredentials: getFlagList("stale-credential"),
    live: liveRequested(),
    applyRotation: getFlagBool("apply-rotation"),
    rotatedMapOut: getFlagStr("rotated-map-out", "").trim(),
    secretBackendEvidence: getFlagStr("secret-backend-evidence", "").trim(),
    hostMountEvidence: getFlagStr("host-mount-evidence", "").trim(),
  });
  emitResult(result, getFlagStr("out", "").trim());
  if (!result.ok) process.exitCode = 2;
}

export async function runCredentialStaging(opts: {
  bundleDir: string;
  out?: string;
  live?: boolean;
  secretBackendEvidence?: string;
  hostMountEvidence?: string;
}) {
  const inputs = await readInputs(opts.bundleDir, opts);
  const errors = validateInputs(inputs, opts.live === true);
  const evidence: CredentialStagingEvidence = {
    schemaVersion: CREDENTIAL_STAGING_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode: opts.live === true ? "live-gated-backend-write" : "fixture-validation",
    credentialDirectory: inputs.manifest.credentialDirectory || CREDENTIAL_MOUNT_TARGET,
    manifestDigest: digestCredentialInput(inputs.manifest),
    credentialMapDigest: digestCredentialInput(inputs.credentialMap),
    runtimeConfigDigest: digestCredentialInput(parseControlPlaneRuntimeConfig(inputs.configText)),
    backendRefs: backendRefs(inputs.credentialMap),
    generatedSecretWritePlanIds: writePlanIds(inputs.credentialMap),
    hostCredentialSourceIds: hostSourceIds(inputs.credentialMap),
    staleCredentialDetection: staleDetection(inputs.credentialMap, []),
    reloadEvidence: reloadEvidence(),
    hostMountEvidence: hostMountEvidence(
      inputs.liveHostMountEvidence,
      requiredFiles(inputs.manifest),
      opts.live === true,
    ),
    ...(inputs.liveBackendWriteEvidence
      ? { liveBackendWriteEvidence: inputs.liveBackendWriteEvidence }
      : {}),
    externalPrerequisites: externalPrerequisites(inputs),
    ok: errors.length === 0,
    errors,
  };
  if (opts.out) await writeJson(opts.out, evidence);
  return evidence;
}

export async function runCredentialRotation(opts: {
  bundleDir: string;
  out?: string;
  staleCredentials?: string[];
  live?: boolean;
  applyRotation?: boolean;
  rotatedMapOut?: string;
  secretBackendEvidence?: string;
  hostMountEvidence?: string;
}) {
  const inputs = await readInputs(opts.bundleDir, opts);
  const stale = opts.staleCredentials || [];
  const rotated = opts.applyRotation ? rotateCredentialMap(inputs.credentialMap, stale) : undefined;
  const errors = [
    ...validateInputs(inputs, opts.live === true),
    ...(opts.applyRotation ? [] : stale.map((file) => `${file}: stale credential active`)),
  ];
  const rotatedPath = opts.rotatedMapOut?.trim();
  if (rotated && rotatedPath) await writeJson(rotatedPath, rotated);
  const evidence: CredentialRotationEvidence = {
    schemaVersion: CREDENTIAL_ROTATION_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode: opts.live === true ? "live-gated-backend-write" : "fixture-validation",
    manifestDigest: digestCredentialInput(inputs.manifest),
    credentialMapDigest: digestCredentialInput(inputs.credentialMap),
    runtimeConfigDigest: digestCredentialInput(parseControlPlaneRuntimeConfig(inputs.configText)),
    backendRefs: backendRefs(inputs.credentialMap),
    generatedSecretWritePlanIds: writePlanIds(inputs.credentialMap),
    hostCredentialSourceIds: hostSourceIds(inputs.credentialMap),
    staleCredentialDetection: staleDetection(inputs.credentialMap, opts.applyRotation ? [] : stale),
    nonSecretConfigSemanticsDigest: digestCredentialInput(nonSecretSemantics(inputs)),
    ...(rotated
      ? {
          rotatedCredentialMapDigest: digestCredentialInput(rotated),
          ...(rotatedPath ? { rotatedCredentialMapPath: rotatedPath } : {}),
        }
      : {}),
    reloadEvidence: reloadEvidence(),
    hostMountEvidence: hostMountEvidence(
      inputs.liveHostMountEvidence,
      requiredFiles(inputs.manifest),
      opts.live === true,
    ),
    ...(inputs.liveBackendWriteEvidence
      ? { liveBackendWriteEvidence: inputs.liveBackendWriteEvidence }
      : {}),
    ok: errors.length === 0,
    errors,
  };
  if (opts.out) await writeJson(opts.out, evidence);
  return evidence;
}

async function readInputs(
  bundleDir: string,
  opts: { live?: boolean; secretBackendEvidence?: string; hostMountEvidence?: string } = {},
): Promise<Inputs> {
  const root = path.resolve(bundleDir);
  const [manifest, credentialMap, configText, supabaseProfile, backendEvidence, mountEvidence] =
    await Promise.all([
      readJson(path.join(root, "credential-manifest.json")),
      readJson(path.join(root, "credential-map.json")),
      fsp.readFile(path.join(root, "config.yaml"), "utf8"),
      readJson(path.join(root, "supabase-postgres.profile.json")).catch(() => undefined),
      opts.live && opts.secretBackendEvidence ? readJson(opts.secretBackendEvidence) : undefined,
      opts.live && opts.hostMountEvidence ? readJson(opts.hostMountEvidence) : undefined,
    ]);
  return {
    manifest,
    credentialMap,
    configText,
    supabaseProfile,
    liveBackendWriteEvidence: backendEvidence,
    liveHostMountEvidence: mountEvidence,
  };
}

function validateInputs(inputs: Inputs, live: boolean): string[] {
  const config = parseControlPlaneRuntimeConfig(inputs.configText);
  return [
    ...validateCredentialMap(inputs.credentialMap, {
      requiredFiles: requiredFiles(inputs.manifest),
      supabaseProjectRef: inputs.supabaseProfile?.provisioning.projectRef,
      connectionMode: inputs.supabaseProfile?.connection.mode,
      reviewedSourceMode: config.reviewedSource.mode,
    }),
    ...validateLiveInputs({
      live,
      backendEvidence: inputs.liveBackendWriteEvidence,
      hostMountEvidence: inputs.liveHostMountEvidence,
      credentialMap: inputs.credentialMap,
      requiredFiles: requiredFiles(inputs.manifest),
      backendRefs: backendRefs(inputs.credentialMap),
      writePlanIds: writePlanIds(inputs.credentialMap),
      hostSourceIds: hostSourceIds(inputs.credentialMap),
    }),
  ];
}

function externalPrerequisites(inputs: Inputs): string[] {
  const reviewedSource =
    inputs.credentialMap.reviewedSource.mode === "github-app"
      ? "reviewed GitHub App credential provider access"
      : "reviewed SSH credential provider access";
  return ["reviewed secret-backend access", reviewedSource, "live-gated host mount access"];
}

function nonSecretSemantics(inputs: Inputs): unknown {
  const config = parseControlPlaneRuntimeConfig(inputs.configText);
  return {
    config,
    manifestFiles: requiredFiles(inputs.manifest),
    credentialMapSources: inputs.credentialMap.entries.map((entry) => ({
      file: entry.file,
      kind: (entry.source as any).kind,
    })),
  };
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function emitResult(value: unknown, out: string): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!out) console.log(text.trimEnd());
}
