import { evidenceObject, evidenceText, freshEvidenceAt } from "./cloud-control-evidence-helpers";
import { validateEdgeIngressProviderPayload } from "./cloud-control-edge-provider-payload";
import {
  cloudflareProviderIdentityErrors,
  vercelProviderIdentityErrors,
} from "./cloud-control-remaining-provider-identity";

const SCHEMAS: Record<string, string> = {
  "aws-attic-cache-service": "aws-attic-cache-service-evidence@1",
  "cloudflare-edge": "cloudflare-edge-evidence@1",
  "vercel-operator-ui": "vercel-operator-ui-evidence@1",
  "remote-build-worker-fleet": "remote-build-worker-fleet-evidence@1",
};

export function validateRemainingProviderCapabilityPayload(
  id: string,
  value: unknown,
  opts: { maxAgeMinutes?: number; awsTopology?: unknown } = {},
): string[] {
  if (!SCHEMAS[id]) return [];
  const payload = evidenceObject(value);
  if (Object.keys(payload).length === 0) return [`${id}: missing typed provider payload`];
  const errors = commonErrors(id, payload, opts);
  if (id === "aws-attic-cache-service") errors.push(...atticErrors(id, payload, opts.awsTopology));
  if (id === "cloudflare-edge") errors.push(...cloudflareErrors(id, payload, opts.awsTopology));
  if (id === "vercel-operator-ui") errors.push(...vercelErrors(id, payload, opts.awsTopology));
  if (id === "remote-build-worker-fleet")
    errors.push(...fleetErrors(id, payload, opts.awsTopology));
  return errors;
}

function commonErrors(
  id: string,
  payload: Record<string, unknown>,
  opts: { maxAgeMinutes?: number },
): string[] {
  const errors: string[] = [];
  if (evidenceText(payload, "schemaVersion") !== SCHEMAS[id])
    errors.push(`${id}: wrong payload schema`);
  if (evidenceText(payload, "capabilityId") !== id) errors.push(`${id}: wrong payload capability`);
  if (!freshEvidenceAt(payload, { maxAgeMinutes: opts.maxAgeMinutes ?? 60 })) {
    errors.push(`${id}: typed payload is missing or stale`);
  }
  const ownership = evidenceObject(payload.ownership);
  const boundary = evidenceText(ownership, "boundary");
  if (!["reviewed-iac", "external-reviewed", "provider-owned-reviewed"].includes(boundary)) {
    errors.push(`${id}: missing reviewed ownership boundary`);
  }
  if (ownership.allowsDirectMutation !== false) {
    errors.push(`${id}: direct provider mutation is not allowed by typed evidence`);
  }
  if (Array.isArray(ownership.mutationCommands) && ownership.mutationCommands.length > 0) {
    errors.push(`${id}: mutation-command evidence is not allowed`);
  }
  if (evidenceObject(payload.smoke).passed !== true) errors.push(`${id}: missing smoke proof`);
  if (evidenceObject(payload.rollback).nonDestructive !== true) {
    errors.push(`${id}: missing non-destructive rollback proof`);
  }
  return errors;
}

function atticErrors(id: string, payload: Record<string, unknown>, topology: unknown): string[] {
  const aws = evidenceObject(payload.aws);
  const accountId = evidenceText(aws, "accountId");
  const region = evidenceText(aws, "region");
  const errors = awsMatchErrors(id, accountId, region, topology);
  requireText(errors, id, payload.endpoint, "identity", "missing attic endpoint identity");
  requireText(errors, id, payload.endpoint, "url", "missing attic endpoint URL");
  requireTrue(errors, id, payload.health, "atticdReady", "missing atticd health proof");
  for (const field of ["put", "get", "metadata", "digestVerified"]) {
    requireTrue(errors, id, payload.cacheObject, field, `missing cache object ${field} proof`);
  }
  requireTrue(errors, id, payload.tokenScope, "cacheScoped", "missing cache-scoped token proof");
  requireTrue(
    errors,
    id,
    payload.tokenScope,
    "leastPrivilege",
    "missing least-privilege token proof",
  );
  return errors;
}

function cloudflareErrors(
  id: string,
  payload: Record<string, unknown>,
  topology: unknown,
): string[] {
  const errors: string[] = [];
  requireText(errors, id, payload.cloudflare, "accountId", "missing Cloudflare account");
  requireText(errors, id, payload.cloudflare, "zoneId", "missing Cloudflare zone");
  requireText(errors, id, payload.dns, "recordName", "missing DNS record proof");
  requireText(errors, id, payload.dns, "target", "missing DNS target proof");
  requireText(errors, id, payload.tls, "mode", "missing TLS mode proof");
  requireText(errors, id, payload.tls, "certificateStatus", "missing certificate posture");
  const waf = evidenceObject(payload.waf);
  if (waf.selected === true && !evidenceText(waf, "rulesetStatus")) {
    errors.push(`${id}: missing selected WAF/ruleset posture`);
  }
  errors.push(...cloudflareProviderIdentityErrors(id, payload, topology));
  errors.push(
    ...validateEdgeIngressProviderPayload(id, payload, {
      awsTopology: topology,
    }),
  );
  return errors;
}

function vercelErrors(id: string, payload: Record<string, unknown>, topology: unknown): string[] {
  const errors: string[] = [];
  for (const field of ["teamId", "projectId", "deploymentId", "environment"]) {
    requireText(errors, id, payload.vercel, field, `missing Vercel ${field}`);
  }
  requireTrue(errors, id, payload.domain, "bound", "missing Vercel domain binding");
  requireText(errors, id, payload.domain, "productionAlias", "missing production alias");
  requireText(errors, id, payload.config, "provenance", "missing environment/config provenance");
  requireTrue(errors, id, payload.posture, "readOnly", "missing read-only UI posture");
  requireTrue(errors, id, payload.posture, "uiApiOnly", "missing UI/API-only posture");
  errors.push(...vercelProviderIdentityErrors(id, payload, topology));
  errors.push(
    ...validateEdgeIngressProviderPayload(id, payload, {
      awsTopology: topology,
    }),
  );
  return errors;
}

function fleetErrors(id: string, payload: Record<string, unknown>, topology: unknown): string[] {
  const aws = evidenceObject(payload.aws);
  const errors = awsMatchErrors(
    id,
    evidenceText(aws, "accountId"),
    evidenceText(aws, "region"),
    topology,
  );
  requireText(errors, id, payload.fleet, "fleetId", "missing worker fleet identity");
  for (const field of ["buckSeparate", "nixSeparate", "notDeploymentScheduler"]) {
    requireTrue(errors, id, payload.authority, field, `missing ${field} authority proof`);
  }
  requireText(errors, id, payload.network, "allowedBoundary", "missing network boundary");
  requireTrue(
    errors,
    id,
    payload.scaling,
    "registrationProven",
    "missing worker registration proof",
  );
  requireTrue(
    errors,
    id,
    payload.scaling,
    "autoscalingPolicyReviewed",
    "missing scaling policy proof",
  );
  requireTrue(errors, id, payload.smoke, "heartbeat", "missing worker heartbeat proof");
  if (evidenceObject(payload.credentials).protectedRuntimeCredentialsReused !== false) {
    errors.push(`${id}: protected runtime credentials must not be reused`);
  }
  return errors;
}

function awsMatchErrors(
  id: string,
  accountId: string,
  region: string,
  topology: unknown,
): string[] {
  const expected = evidenceObject(topology);
  const errors: string[] = [];
  if (!evidenceText(expected, "accountId") || !evidenceText(expected, "region")) {
    errors.push(`${id}: missing selected AWS topology evidence`);
  }
  if (!accountId) errors.push(`${id}: missing AWS account linkage`);
  if (!region) errors.push(`${id}: missing AWS region linkage`);
  if (evidenceText(expected, "accountId") && accountId !== evidenceText(expected, "accountId")) {
    errors.push(`${id}: AWS account does not match selected topology`);
  }
  if (evidenceText(expected, "region") && region !== evidenceText(expected, "region")) {
    errors.push(`${id}: AWS region does not match selected topology`);
  }
  return errors;
}

function requireText(
  errors: string[],
  id: string,
  value: unknown,
  field: string,
  message: string,
): void {
  if (!evidenceText(value, field)) errors.push(`${id}: ${message}`);
}

function requireTrue(
  errors: string[],
  id: string,
  value: unknown,
  field: string,
  message: string,
): void {
  if (evidenceObject(value)[field] !== true) errors.push(`${id}: ${message}`);
}
