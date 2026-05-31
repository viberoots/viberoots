import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagList, getFlagStr } from "../lib/cli";
import { validateCredentialMap, type CredentialMap } from "./cloud-control-credential-map";
import { parseControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import {
  CREDENTIAL_MOUNT_TARGET,
  CREDENTIAL_ROTATION_SCHEMA,
  CREDENTIAL_STAGING_SCHEMA,
  type CredentialRotationEvidence,
  type CredentialStagingEvidence,
  type ReloadEvidence,
} from "./control-plane-credential-staging-types";
import { digestCredentialInput } from "./control-plane-credential-staging-evidence";
import type { SupabaseManagedPostgresProfile } from "./control-plane-supabase-postgres-profile";

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
};

export async function runCredentialStagingCommand(): Promise<void> {
  const result = await runCredentialStaging({
    bundleDir: getFlagStr("bundle-dir", ".").trim(),
    out: getFlagStr("out", "").trim(),
  });
  emitResult(result, getFlagStr("out", "").trim());
  if (!result.ok) process.exitCode = 2;
}

export async function runCredentialRotationCommand(): Promise<void> {
  const result = await runCredentialRotation({
    bundleDir: getFlagStr("bundle-dir", ".").trim(),
    out: getFlagStr("out", "").trim(),
    staleCredentials: getFlagList("stale-credential"),
  });
  emitResult(result, getFlagStr("out", "").trim());
  if (!result.ok) process.exitCode = 2;
}

export async function runCredentialStaging(opts: { bundleDir: string; out?: string }) {
  const inputs = await readInputs(opts.bundleDir);
  const errors = validateInputs(inputs);
  const evidence: CredentialStagingEvidence = {
    schemaVersion: CREDENTIAL_STAGING_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode: "fixture-validation",
    credentialDirectory: inputs.manifest.credentialDirectory || CREDENTIAL_MOUNT_TARGET,
    manifestDigest: digestCredentialInput(inputs.manifest),
    credentialMapDigest: digestCredentialInput(inputs.credentialMap),
    runtimeConfigDigest: digestCredentialInput(parseControlPlaneRuntimeConfig(inputs.configText)),
    backendRefs: backendRefs(inputs.credentialMap),
    generatedSecretWritePlanIds: writePlanIds(inputs.credentialMap),
    hostCredentialSourceIds: hostSourceIds(inputs.credentialMap),
    staleCredentialDetection: staleDetection(inputs.credentialMap, []),
    reloadEvidence: reloadEvidence(),
    hostMountEvidence: hostMountEvidence(inputs),
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
}) {
  const inputs = await readInputs(opts.bundleDir);
  const stale = opts.staleCredentials || [];
  const errors = [
    ...validateInputs(inputs),
    ...stale.map((file) => `${file}: stale credential active`),
  ];
  const evidence: CredentialRotationEvidence = {
    schemaVersion: CREDENTIAL_ROTATION_SCHEMA,
    generatedAt: new Date().toISOString(),
    mode: "fixture-validation",
    manifestDigest: digestCredentialInput(inputs.manifest),
    credentialMapDigest: digestCredentialInput(inputs.credentialMap),
    runtimeConfigDigest: digestCredentialInput(parseControlPlaneRuntimeConfig(inputs.configText)),
    backendRefs: backendRefs(inputs.credentialMap),
    generatedSecretWritePlanIds: writePlanIds(inputs.credentialMap),
    hostCredentialSourceIds: hostSourceIds(inputs.credentialMap),
    staleCredentialDetection: staleDetection(inputs.credentialMap, stale),
    nonSecretConfigSemanticsDigest: digestCredentialInput(nonSecretSemantics(inputs)),
    reloadEvidence: reloadEvidence(),
    hostMountEvidence: hostMountEvidence(inputs),
    ok: errors.length === 0,
    errors,
  };
  if (opts.out) await writeJson(opts.out, evidence);
  return evidence;
}

function hostMountEvidence(inputs: Inputs) {
  return {
    wiringMode: "bind-mounted-credential-directory" as const,
    targetPath: CREDENTIAL_MOUNT_TARGET,
    filenameSet: requiredFiles(inputs.manifest),
    owner: { uid: 10001, gid: 10001 },
    permissions: "0400",
  };
}

async function readInputs(bundleDir: string): Promise<Inputs> {
  const root = path.resolve(bundleDir);
  const [manifest, credentialMap, configText, supabaseProfile] = await Promise.all([
    readJson(path.join(root, "credential-manifest.json")),
    readJson(path.join(root, "credential-map.json")),
    fsp.readFile(path.join(root, "config.yaml"), "utf8"),
    readJson(path.join(root, "supabase-postgres.profile.json")).catch(() => undefined),
  ]);
  return { manifest, credentialMap, configText, supabaseProfile };
}

function validateInputs(inputs: Inputs): string[] {
  const config = parseControlPlaneRuntimeConfig(inputs.configText);
  return validateCredentialMap(inputs.credentialMap, {
    requiredFiles: requiredFiles(inputs.manifest),
    supabaseProjectRef: inputs.supabaseProfile?.provisioning.projectRef,
    connectionMode: inputs.supabaseProfile?.connection.mode,
    reviewedSourceMode: config.reviewedSource.mode,
  });
}

function backendRefs(map: CredentialMap): string[] {
  return map.entries.flatMap((entry) => {
    const source = entry.source as any;
    return source.kind === "secret-backend-ref" ? [source.ref] : [];
  });
}

function writePlanIds(map: CredentialMap): string[] {
  return map.entries.flatMap((entry) => {
    const source = entry.source as any;
    return source.kind === "generated-secret-write-plan" ? [source.writePlanRef] : [];
  });
}

function hostSourceIds(map: CredentialMap): string[] {
  return map.entries.flatMap((entry) => {
    const source = entry.source as any;
    return source.kind === "host-credential-source" ? [source.hostSourceRef] : [];
  });
}

function staleDetection(map: CredentialMap, staleFiles: string[]) {
  const stale = new Set(staleFiles);
  return map.entries.map((entry) => ({
    file: entry.file,
    stale: stale.has(entry.file),
    evidenceRef: entry.rotation.staleDetectionEvidenceRef,
  }));
}

function reloadEvidence(): ReloadEvidence {
  return {
    mode: "fixture-reload-evidence",
    service: {
      unit: "deployment-control-plane-service.service",
      action: "restart-recorded",
      evidenceRef: "evidence://credential-staging/reload/service",
    },
    workers: [1, 2].map((index) => ({
      unit: `deployment-control-plane-worker-${index}.service`,
      action: "restart-recorded",
      evidenceRef: `evidence://credential-staging/reload/worker-${index}`,
    })),
  };
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

function requiredFiles(manifest: Manifest): string[] {
  return [...new Set((manifest.requiredFiles || []).map(String))].sort();
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
