import { getFlagBool } from "../lib/cli";
import type { CredentialMap } from "./cloud-control-credential-map";
import { CREDENTIAL_MOUNT_TARGET } from "./control-plane-credential-staging-types";
import type { LiveBackendWriteEvidence } from "./control-plane-credential-staging-types";

export type LiveHostMountInput = {
  evidenceRef?: string;
  filenameSet?: string[];
  owner?: { uid?: number; gid?: number };
  permissions?: string;
  targetPath?: string;
};

export function liveRequested(): boolean {
  return getFlagBool("live") || process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING === "1";
}

export function validateLiveInputs(opts: {
  live: boolean;
  backendEvidence?: LiveBackendWriteEvidence;
  hostMountEvidence?: LiveHostMountInput;
  credentialMap: CredentialMap;
  requiredFiles: string[];
  backendRefs: string[];
  writePlanIds: string[];
  hostSourceIds: string[];
}): string[] {
  if (!opts.live) return [];
  const errors: string[] = [];
  if (process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING !== "1") {
    errors.push("live credential staging requires VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1");
  }
  errors.push(...validateLiveBackendWriteEvidence(opts));
  errors.push(...validateLiveHostMountInput(opts.hostMountEvidence, opts.requiredFiles));
  return errors;
}

export function hostMountEvidence(
  observed: LiveHostMountInput | undefined,
  requiredFiles: string[],
  live: boolean,
) {
  return {
    wiringMode: "bind-mounted-credential-directory" as const,
    targetPath: (observed?.targetPath as typeof CREDENTIAL_MOUNT_TARGET) || CREDENTIAL_MOUNT_TARGET,
    filenameSet: observed?.filenameSet || requiredFiles,
    owner: {
      uid: Number(observed?.owner?.uid ?? 10001),
      gid: Number(observed?.owner?.gid ?? 10001),
    },
    permissions: observed?.permissions || "0400",
    verifiedBy: live ? ("live-host-check" as const) : ("fixture-manifest" as const),
    ...(observed?.evidenceRef ? { evidenceRef: observed.evidenceRef } : {}),
  };
}

function validateLiveBackendWriteEvidence(opts: {
  backendEvidence?: LiveBackendWriteEvidence;
  backendRefs: string[];
  writePlanIds: string[];
  hostSourceIds: string[];
}): string[] {
  const evidence = opts.backendEvidence;
  if (!evidence) return ["live credential staging requires --secret-backend-evidence"];
  const errors: string[] = [];
  if (evidence.schemaVersion !== "control-plane-credential-live-backend-write@1") {
    errors.push("live credential backend write evidence schema invalid");
  }
  if (evidence.liveGate !== "VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1") {
    errors.push("live credential backend write evidence is not tied to the live gate");
  }
  if (evidence.backend !== "infisical") errors.push("live credential backend must be infisical");
  if (evidence.noSecretValuesPersisted !== true) {
    errors.push("live credential backend evidence must prove no local secret persistence");
  }
  if (!isEvidenceRef(evidence.evidenceRef)) errors.push("live backend evidence ref is required");
  compareSets(
    errors,
    "generated secret write plans",
    evidence.generatedSecretWritePlanIds,
    opts.writePlanIds,
  );
  compareSets(errors, "backend refs", evidence.backendRefs, opts.backendRefs);
  compareSets(
    errors,
    "host credential source ids",
    evidence.hostCredentialSourceIds,
    opts.hostSourceIds,
  );
  return errors;
}

function validateLiveHostMountInput(
  evidence: LiveHostMountInput | undefined,
  expected: string[],
): string[] {
  if (!evidence) return ["live credential staging requires --host-mount-evidence"];
  const errors: string[] = [];
  if (evidence.targetPath !== CREDENTIAL_MOUNT_TARGET) {
    errors.push(`live host mount target must be ${CREDENTIAL_MOUNT_TARGET}`);
  }
  if (JSON.stringify(sortedStrings(evidence.filenameSet || [])) !== JSON.stringify(expected)) {
    errors.push("live host mount filename set does not match current manifest");
  }
  if (evidence.owner?.uid !== 10001 || evidence.owner?.gid !== 10001) {
    errors.push("live host mount ownership must be uid/gid 10001");
  }
  if (evidence.permissions !== "0400") errors.push("live host mount permissions must be 0400");
  if (!isEvidenceRef(evidence.evidenceRef)) errors.push("live host mount evidence ref is required");
  return errors;
}

function compareSets(errors: string[], label: string, actual: unknown, expected: string[]): void {
  if (JSON.stringify(sortedStrings(actual)) !== JSON.stringify(sortedStrings(expected))) {
    errors.push(`live credential backend ${label} do not match current credential map`);
  }
}

function sortedStrings(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.map(String))].sort() : [];
}

function isEvidenceRef(value: unknown): boolean {
  return typeof value === "string" && /^evidence:\/\//.test(value);
}
