import {
  type CutoverEvidence,
  type CutoverValidationOptions,
  type CutoverValidationResult,
} from "./cloud-control-cutover-types";
import {
  requiredAwsProviderCapabilities,
  validateAwsCutoverTopology,
} from "./cloud-control-cutover-aws";
import { validateCutoverProviderCapabilities } from "./cloud-control-cutover-provider-capabilities";
import { validateControlPlaneImagePublicationEvidence } from "./control-plane-image-publication";

const BASE_HEALTH = [
  "cloudHealth",
  "readiness",
  "workerHeartbeats",
  "databaseConnectivity",
  "artifactStoreCompatibility",
  "authCallbackReachability",
  "uiReads",
  "mcpReads",
];

export function validateCloudControlCutover(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): CutoverValidationResult {
  const errors = [
    ...validateIdentity(evidence, options),
    ...validateBaseHealth(evidence),
    ...validateImagePublication(evidence, options),
    ...validateLatestDeployment(evidence, options),
    ...validateCutoverProviderCapabilities(
      evidence,
      requiredProviderCapabilities(evidence, options),
    ),
    ...validateAwsCutoverTopology(evidence, options),
    ...validateOperation(evidence, options.operation),
    ...validateAudit(evidence, options.operation),
  ];
  return { ok: errors.length === 0, errors, checklist: checklist(options) };
}

function validateImagePublication(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  const image = String(evidence.latestNonProductionDeployment?.image || "");
  const errors = [
    ...(image ? [] : ["missing latest non-production image digest evidence"]),
    ...(options.expectedImageBuildIdentity
      ? []
      : ["cutover validation requires expected image build identity"]),
  ];
  return [
    ...errors,
    ...validateControlPlaneImagePublicationEvidence(
      evidence.imagePublication,
      image,
      options.expectedImageBuildIdentity,
    ),
  ];
}

function requiredProviderCapabilities(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  return unique([
    ...options.selectedCapabilities,
    ...requiredAwsProviderCapabilities(evidence, options),
  ]);
}

function validateIdentity(evidence: CutoverEvidence, options: CutoverValidationOptions): string[] {
  const errors: string[] = [];
  if (evidence.hostProfile !== options.expectedHostProfile) {
    errors.push(`evidence host profile ${evidence.hostProfile || "<missing>"} does not match`);
  }
  if (options.expectedRegion && evidence.region !== options.expectedRegion) {
    errors.push(`evidence region ${evidence.region || "<missing>"} does not match`);
  }
  const generatedAt = Date.parse(evidence.generatedAt || "");
  if (!Number.isFinite(generatedAt)) errors.push("evidence generatedAt is missing or invalid");
  const ageMs = Date.now() - generatedAt;
  if (Number.isFinite(generatedAt) && ageMs > options.maxAgeMinutes * 60_000) {
    errors.push("evidence is stale");
  }
  return errors;
}

function validateBaseHealth(evidence: CutoverEvidence): string[] {
  return BASE_HEALTH.flatMap((name) =>
    evidence.health?.[name] ? [] : [`missing ${name} evidence`],
  );
}

function validateLatestDeployment(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  const latest = evidence.latestNonProductionDeployment || {};
  const errors: string[] = [];
  if (!latest.runId) errors.push("missing latest non-production deployment evidence");
  if (latest.hostProfile !== options.expectedHostProfile) {
    errors.push("latest non-production deployment evidence is from the wrong host profile");
  }
  if (latest.trafficIngressHostProfile !== options.expectedHostProfile) {
    errors.push("latest non-production traffic/ingress is not pointed at the cloud host profile");
  }
  if (latest.cloudPrimaryPath !== true) {
    errors.push("latest non-production deployment did not run through the cloud-primary path");
  }
  if (latest.stagingDeploymentSucceeded !== true) {
    errors.push("latest protected/shared staging deployment did not succeed through cloud-primary");
  }
  return errors;
}

function validateOperation(evidence: CutoverEvidence, operation: string): string[] {
  if (operation === "restore") return requireFields(evidence.restore, "restore", RESTORE_FIELDS);
  if (operation === "rollback") {
    return [
      ...requireFields(evidence.rollback, "rollback", ROLLBACK_FIELDS),
      ...validateStandby(evidence),
    ];
  }
  if (operation === "break-glass") {
    return requireFields(evidence.breakGlass, "break-glass", BREAK_GLASS_FIELDS);
  }
  return validateStandby(evidence);
}

const RESTORE_FIELDS = [
  "databaseRecords",
  "artifactObjects",
  "imageDigest",
  "config",
  "exportedConfigDigest",
  "credentialManifest",
  "authConfiguration",
  "durableStateReferences",
];
const ROLLBACK_FIELDS = ["trafficReturn", "authoritySemanticsUnchanged"];
const BREAK_GLASS_FIELDS = [
  "statusInspect",
  "pauseWorkers",
  "auditPreserved",
  "providerMutationBlocked",
];

function validateStandby(evidence: CutoverEvidence): string[] {
  const standby = evidence.standby || {};
  if (standby.mode && standby.doubleExecutionPrevented) return [];
  return ["standby evidence must prove mode and double-execution prevention"];
}

function requireFields(
  section: Record<string, unknown> | undefined,
  name: string,
  fields: string[],
): string[] {
  return fields.flatMap((field) =>
    hasEvidence(section?.[field]) ? [] : [`missing ${name} ${field} evidence`],
  );
}

function hasEvidence(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
}

function validateAudit(evidence: CutoverEvidence, operation: string): string[] {
  const audit = evidence.audit || {};
  return audit[operation] ? [] : [`missing ${operation} audit evidence`];
}

function checklist(options: CutoverValidationOptions): string[] {
  return [
    `validate ${options.expectedHostProfile} health/readiness and auth callback reachability`,
    "confirm UI and MCP reads use the cloud-primary endpoint",
    "confirm standby workers cannot double-execute submissions",
    `confirm ${options.operation} audit evidence is recorded`,
  ];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
