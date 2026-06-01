import * as fsp from "node:fs/promises";
import path from "node:path";

export const RUNTIME_HTTP_SCHEMA = "cloud-control-runtime-http-evidence@1";
export const RUNTIME_HTTP_CHECKS = ["health", "readiness", "worker-heartbeats"] as const;

export type RuntimeHttpCheck = (typeof RUNTIME_HTTP_CHECKS)[number];

export type RuntimeHttpEvidence = {
  schemaVersion?: string;
  check?: string;
  checkedAt?: string;
  url?: string;
  host?: string;
  expected?: {
    publicUrl?: string;
    host?: string;
    hostProfile?: string;
    profileIdentity?: string;
    deploymentIds?: string[];
    workerCount?: number;
  };
  credentialSource?: { kind?: string; tokenFile?: string; credentialRootEnv?: string };
  status?: { ok?: boolean; httpStatus?: number };
  dependencies?: Record<string, unknown>;
  body?: unknown;
};

export type RuntimeHttpValidationOptions = {
  expectedPublicUrl?: string;
  expectedHostProfile: string;
  expectedProfileIdentity?: string;
  expectedWorkerCount?: number;
  maxAgeMinutes: number;
};

export async function readRuntimeHttpEvidence(
  root: string,
  check: RuntimeHttpCheck,
): Promise<RuntimeHttpEvidence | undefined> {
  return readJson(path.join(root, `http-${check}.json`));
}

export function validateRuntimeHttpEvidenceSet(
  health: Record<string, unknown> | undefined,
  options: RuntimeHttpValidationOptions,
): string[] {
  return RUNTIME_HTTP_CHECKS.flatMap((check) =>
    validateRuntimeHttpEvidence(health?.[keyFor(check)], check, options),
  );
}

export function validateRuntimeHttpEvidence(
  value: unknown,
  check: RuntimeHttpCheck,
  options: RuntimeHttpValidationOptions,
): string[] {
  const label = `runtime HTTP ${check}`;
  if (!value || typeof value !== "object") return [`${label} evidence must be a typed envelope`];
  const evidence = value as RuntimeHttpEvidence;
  const errors = [
    ...validateEnvelope(evidence, check, label),
    ...validateFreshness(evidence, label, options.maxAgeMinutes),
    ...validateBinding(evidence, check, label, options),
    ...validateCredentialSource(evidence, label, check),
    ...validateNoInlineToken(evidence, label),
  ];
  if (check === "readiness") errors.push(...validateReadiness(evidence));
  if (check === "worker-heartbeats") errors.push(...validateHeartbeats(evidence, options));
  return errors;
}

function keyFor(check: RuntimeHttpCheck): string {
  return check === "worker-heartbeats"
    ? "workerHeartbeats"
    : check === "health"
      ? "cloudHealth"
      : check;
}

function validateEnvelope(evidence: RuntimeHttpEvidence, check: RuntimeHttpCheck, label: string) {
  const errors: string[] = [];
  if (evidence.schemaVersion !== RUNTIME_HTTP_SCHEMA) errors.push(`${label} schemaVersion invalid`);
  if (evidence.check !== check) errors.push(`${label} check does not match`);
  if (evidence.status?.ok !== true || !isSuccessStatus(evidence.status?.httpStatus)) {
    errors.push(`${label} status did not pass`);
  }
  if (!evidence.body || typeof evidence.body !== "object") errors.push(`${label} body missing`);
  return errors;
}

function validateFreshness(evidence: RuntimeHttpEvidence, label: string, maxAgeMinutes: number) {
  const checkedAt = Date.parse(String(evidence.checkedAt || ""));
  if (!Number.isFinite(checkedAt)) return [`${label} checkedAt is missing or invalid`];
  return Date.now() - checkedAt > maxAgeMinutes * 60_000 ? [`${label} checkedAt is stale`] : [];
}

function validateBinding(
  evidence: RuntimeHttpEvidence,
  check: RuntimeHttpCheck,
  label: string,
  options: RuntimeHttpValidationOptions,
) {
  const errors: string[] = [];
  const expectedHost = hostOf(options.expectedPublicUrl || evidence.expected?.publicUrl || "");
  const urlHost = hostOf(evidence.url || "");
  const evidenceHost = urlHost || evidence.host || "";
  if (!evidence.url || !urlHost || evidence.host !== urlHost)
    errors.push(`${label} URL/host binding invalid`);
  if (expectedHost && evidenceHost !== expectedHost)
    errors.push(`${label} host does not match expected URL`);
  if (evidence.expected?.hostProfile !== options.expectedHostProfile) {
    errors.push(`${label} host profile does not match expected profile`);
  }
  errors.push(...validateRuntimeIdentity(evidence, check, label, options));
  return errors;
}

function validateRuntimeIdentity(
  evidence: RuntimeHttpEvidence,
  check: RuntimeHttpCheck,
  label: string,
  options: RuntimeHttpValidationOptions,
): string[] {
  if (!identityExpected(options)) return [];
  if (check === "worker-heartbeats") return [];
  const identity = responseIdentity(evidence, check);
  if (!identity) return [`${label} response missing runtime identity`];
  return identity === options.expectedProfileIdentity
    ? []
    : [`${label} response runtime identity does not match expected profile`];
}

function validateCredentialSource(
  evidence: RuntimeHttpEvidence,
  label: string,
  check: RuntimeHttpCheck,
) {
  const kind = String(evidence.credentialSource?.kind || "");
  if (check !== "worker-heartbeats")
    return ["none", "public"].includes(kind) ? [] : [`${label} credential source invalid`];
  return ["token_file", "credential_file"].includes(kind) && evidence.credentialSource?.tokenFile
    ? []
    : [`${label} must use token-file credential provenance`];
}

function validateNoInlineToken(evidence: RuntimeHttpEvidence, label: string) {
  const text = JSON.stringify(evidence);
  if (
    /"authorization"\s*:|"token(Value|Raw|Inline)"\s*:|Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(text)
  ) {
    return [`${label} evidence must not contain inline token values`];
  }
  return [];
}

function validateReadiness(evidence: RuntimeHttpEvidence) {
  const deps = evidence.dependencies || {};
  return [
    dependencyOk(deps.database, "database"),
    dependencyOk(deps.artifactStore, "artifact store"),
    dependencyOk(deps.workerQueueLocks, "worker queue/locks"),
    dependencyOk(deps.runtimeConfig, "runtime config"),
  ].filter(Boolean) as string[];
}

function validateHeartbeats(evidence: RuntimeHttpEvidence, options: RuntimeHttpValidationOptions) {
  const workers = Array.isArray((evidence.body as any)?.workers)
    ? (evidence.body as any).workers
    : [];
  const errors: string[] = [];
  if (workers.length < Math.max(1, options.expectedWorkerCount || 1)) {
    errors.push("runtime HTTP worker-heartbeats missing expected worker heartbeat count");
  }
  for (const worker of workers) {
    if (worker.status !== "running")
      errors.push(`runtime HTTP worker ${worker.workerId || "<missing>"} is not running`);
    if (!worker.workerId || !worker.instanceId)
      errors.push("runtime HTTP worker heartbeat missing identity");
    if (identityExpected(options) && worker.instanceId !== options.expectedProfileIdentity) {
      errors.push(
        `runtime HTTP worker ${worker.workerId || "<missing>"} identity does not match profile`,
      );
    }
    errors.push(
      ...validateFreshness(
        { checkedAt: worker.lastSeenAt },
        "runtime HTTP worker heartbeat",
        options.maxAgeMinutes,
      ),
    );
  }
  return errors;
}

function dependencyOk(value: unknown, name: string): string {
  return value && typeof value === "object" && (value as any).ok === true
    ? ""
    : `runtime HTTP readiness missing passing ${name} dependency detail`;
}

function responseIdentity(evidence: RuntimeHttpEvidence, check: RuntimeHttpCheck): string {
  const body = evidence.body as any;
  if (check === "health") return String(body?.instanceId || body?.profileIdentity || "");
  const runtime = (evidence.dependencies?.runtimeConfig || body?.runtimeConfig) as any;
  return String(runtime?.profileIdentity || runtime?.instanceId || "");
}

function identityExpected(options: RuntimeHttpValidationOptions): boolean {
  return Boolean(options.expectedProfileIdentity);
}

function isSuccessStatus(status: unknown): boolean {
  return typeof status === "number" && status >= 200 && status < 300;
}

function hostOf(value: string): string {
  try {
    return value ? new URL(value).host : "";
  } catch {
    return "";
  }
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}
