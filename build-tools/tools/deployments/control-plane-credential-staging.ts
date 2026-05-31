import * as fsp from "node:fs/promises";
import { getFlagBool, getFlagList, getFlagStr } from "../lib/cli";
import { parseControlPlaneRuntimeConfig } from "./control-plane-runtime-config";
import {
  CREDENTIAL_MOUNT_TARGET,
  CREDENTIAL_ROTATION_SCHEMA,
  CREDENTIAL_STAGING_SCHEMA,
  type CredentialRotationEvidence,
  type CredentialStagingEvidence,
} from "./control-plane-credential-staging-types";
import { digestCredentialInput } from "./control-plane-credential-staging-evidence";
import { rotateCredentialMap } from "./control-plane-credential-rotation";
import { hostMountEvidence, liveRequested } from "./control-plane-credential-staging-live";
import {
  runLiveCredentialExecution,
  type LiveExecutionResult,
} from "./control-plane-credential-live-execution";
import {
  readCredentialStagingInputs,
  type CredentialStagingInputs,
} from "./control-plane-credential-staging-inputs";
import {
  backendRefs,
  hostSourceIds,
  reloadEvidence,
  requiredFiles,
  staleDetection,
  writePlanIds,
} from "./control-plane-credential-staging-helpers";
import {
  externalPrerequisites,
  nonSecretSemantics,
  validateCredentialStagingInputs,
} from "./control-plane-credential-staging-validate";
import { liveFlagOpts } from "./control-plane-credential-staging-cli-flags";

export async function runCredentialStagingCommand(): Promise<void> {
  const result = await runCredentialStaging({
    bundleDir: getFlagStr("bundle-dir", ".").trim(),
    out: getFlagStr("out", "").trim(),
    live: liveRequested(),
    ...liveFlagOpts(),
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
    ...liveFlagOpts(),
  });
  emitResult(result, getFlagStr("out", "").trim());
  if (!result.ok) process.exitCode = 2;
}

export async function runCredentialStaging(opts: {
  bundleDir: string;
  out?: string;
  live?: boolean;
  liveBackendProfile?: string;
  secretBackendEvidence?: string;
  credentialDirectory?: string;
  liveHostVerificationEvidence?: string;
  liveHostVerifierProfile?: string;
  liveHostVerifierTrustProfile?: string;
  credentialOwnerUid?: number;
  credentialOwnerGid?: number;
  hostMountEvidence?: string;
}) {
  const inputs = await readCredentialStagingInputs(opts.bundleDir, opts);
  const liveExecution = await runLive(inputs, opts);
  const liveInputs = applyLiveExecution(inputs, liveExecution);
  const errors = [
    ...liveExecution.errors,
    ...validateCredentialStagingInputs(liveInputs, opts.live === true),
  ];
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
      liveInputs.liveHostMountEvidence,
      requiredFiles(inputs.manifest),
      opts.live === true,
    ),
    ...(inputs.externalReviewedBackendProof
      ? { externalReviewedBackendProof: inputs.externalReviewedBackendProof }
      : {}),
    ...(inputs.externalReviewedHostProof
      ? { externalReviewedHostProof: inputs.externalReviewedHostProof }
      : {}),
    ...(liveInputs.liveBackendWriteEvidence
      ? { deploymentOwnedLiveBackendWrite: liveInputs.liveBackendWriteEvidence }
      : {}),
    ...(liveInputs.liveHostMountEvidence
      ? { deploymentOwnedLiveHostVerification: liveInputs.liveHostMountEvidence }
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
  liveBackendProfile?: string;
  secretBackendEvidence?: string;
  credentialDirectory?: string;
  liveHostVerificationEvidence?: string;
  liveHostVerifierProfile?: string;
  liveHostVerifierTrustProfile?: string;
  credentialOwnerUid?: number;
  credentialOwnerGid?: number;
  hostMountEvidence?: string;
}) {
  const inputs = await readCredentialStagingInputs(opts.bundleDir, opts);
  const liveExecution = await runLive(inputs, opts);
  const liveInputs = applyLiveExecution(inputs, liveExecution);
  const stale = opts.staleCredentials || [];
  const rotated = opts.applyRotation ? rotateCredentialMap(inputs.credentialMap, stale) : undefined;
  const errors = [
    ...liveExecution.errors,
    ...validateCredentialStagingInputs(liveInputs, opts.live === true),
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
      liveInputs.liveHostMountEvidence,
      requiredFiles(inputs.manifest),
      opts.live === true,
    ),
    ...(inputs.externalReviewedBackendProof
      ? { externalReviewedBackendProof: inputs.externalReviewedBackendProof }
      : {}),
    ...(inputs.externalReviewedHostProof
      ? { externalReviewedHostProof: inputs.externalReviewedHostProof }
      : {}),
    ...(liveInputs.liveBackendWriteEvidence
      ? { deploymentOwnedLiveBackendWrite: liveInputs.liveBackendWriteEvidence }
      : {}),
    ...(liveInputs.liveHostMountEvidence
      ? { deploymentOwnedLiveHostVerification: liveInputs.liveHostMountEvidence }
      : {}),
    ok: errors.length === 0,
    errors,
  };
  if (opts.out) await writeJson(opts.out, evidence);
  return evidence;
}

async function runLive(
  inputs: CredentialStagingInputs,
  opts: {
    live?: boolean;
    bundleDir: string;
    liveBackendProfile?: string;
    credentialDirectory?: string;
    liveHostVerificationEvidence?: string;
    liveHostVerifierProfile?: string;
    liveHostVerifierTrustProfile?: string;
    credentialOwnerUid?: number;
    credentialOwnerGid?: number;
  },
): Promise<LiveExecutionResult> {
  return await runLiveCredentialExecution({
    live: opts.live === true,
    bundleDir: opts.bundleDir,
    credentialMap: inputs.credentialMap,
    requiredFiles: requiredFiles(inputs.manifest),
    liveHostVerificationProvided: !!inputs.liveHostMountEvidence,
    liveBackendProfile: opts.liveBackendProfile,
    credentialDirectory: opts.credentialDirectory,
    credentialOwnerUid: opts.credentialOwnerUid,
    credentialOwnerGid: opts.credentialOwnerGid,
  });
}

function applyLiveExecution(
  inputs: CredentialStagingInputs,
  live: LiveExecutionResult,
): CredentialStagingInputs {
  return {
    ...inputs,
    liveBackendWriteEvidence: live.backendWrite,
    liveHostMountEvidence: live.hostVerification || inputs.liveHostMountEvidence,
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function emitResult(value: unknown, out: string): void {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (!out) console.log(text.trimEnd());
}
