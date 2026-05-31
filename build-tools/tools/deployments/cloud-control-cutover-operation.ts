import type { CutoverEvidence } from "./cloud-control-cutover-types";

export function validateCutoverOperationEvidence(
  evidence: CutoverEvidence,
  operation: string,
): string[] {
  if (operation === "restore") {
    return [
      ...validateOperationEnvelope(evidence.restore, "restore", evidence),
      ...requireEvidence(evidence.restore, "restore", RESTORE_FIELDS),
    ];
  }
  if (operation === "rollback") {
    return [
      ...validateOperationEnvelope(evidence.rollback, "rollback", evidence),
      ...requireEvidence(evidence.rollback, "rollback", ROLLBACK_FIELDS),
      ...validateStandby(evidence),
    ];
  }
  if (operation === "break-glass") {
    return [
      ...validateOperationEnvelope(evidence.breakGlass, "break-glass", evidence),
      ...requireEvidence(evidence.breakGlass, "break-glass", BREAK_GLASS_FIELDS),
    ];
  }
  return validateStandby(evidence);
}

const RESTORE_FIELDS = [
  "databaseRecords",
  "artifactObjects",
  "stageState",
  "imageDigest",
  "configDigest",
  "credentialManifestDigest",
  "authConfiguration",
  "durableStateReferences",
];
const ROLLBACK_FIELDS = [
  "previousHostProfile",
  "trafficTarget",
  "standbyServiceMode",
  "workerDrain",
  "providerLocks",
  "inFlightQueuePosture",
  "doubleExecutionPrevention",
];
const BREAK_GLASS_FIELDS = [
  "incidentRef",
  "statusInspect",
  "workerFreeze",
  "auditPreserved",
  "providerMutationBlocked",
  "incidentBoundedAccess",
];

function validateStandby(evidence: CutoverEvidence): string[] {
  const standby = evidence.standby || {};
  return [
    ...validateOperationEnvelope(standby, "standby", evidence),
    ...(["service-only", "worker-only", "fully-enabled", "fully-disabled"].includes(
      String(standby.mode || ""),
    )
      ? []
      : ["standby evidence mode is unsupported"]),
    ...requireEvidence(standby, "standby", [
      "serviceMode",
      "workerMode",
      "doubleExecutionPrevention",
    ]),
  ];
}

function requireEvidence(
  section: Record<string, unknown> | undefined,
  name: string,
  fields: string[],
): string[] {
  return fields.flatMap((field) =>
    fieldEvidence(section?.[field], field) ? [] : [`missing ${name} ${field} evidence`],
  );
}

function validateOperationEnvelope(
  section: Record<string, unknown> | undefined,
  name: string,
  evidence: CutoverEvidence,
): string[] {
  const errors: string[] = [];
  if (!section || typeof section !== "object") return [`missing ${name} evidence`];
  if (!evidenceRef(section.operationIdentity)) {
    errors.push(`${name} evidence requires operation identity`);
  }
  if (section.sourceHost !== evidence.sourceHost) {
    errors.push(`${name} evidence source host does not match cutover source host`);
  }
  if (section.hostProfile !== evidence.hostProfile) {
    errors.push(`${name} evidence host profile does not match cutover host profile`);
  }
  if (!freshTimestamp(section.checkedAt)) errors.push(`${name} evidence checkedAt is invalid`);
  for (const field of ["imageDigest", "configDigest", "credentialManifestDigest"] as const) {
    if (section[field] !== evidence[field]) {
      errors.push(`${name} evidence ${field} does not match cutover evidence`);
    }
  }
  return errors;
}

function evidenceRef(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(evidenceRef);
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === "cloud-cutover-evidence-ref@1" &&
    typeof record.evidenceRef === "string" &&
    record.evidenceRef.trim().length > 0 &&
    freshTimestamp(record.checkedAt) &&
    typeof record.sourceHost === "string" &&
    record.sourceHost.trim().length > 0
  );
}

function fieldEvidence(value: unknown, field: string): boolean {
  if (["imageDigest", "configDigest", "credentialManifestDigest"].includes(field)) {
    return typeof value === "string" && value.trim().length > 0;
  }
  if (field === "incidentRef") {
    return typeof value === "string" && /^incident:\/\//.test(value);
  }
  return evidenceRef(value);
}

function freshTimestamp(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
