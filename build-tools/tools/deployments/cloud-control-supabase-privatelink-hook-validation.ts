import { freshEvidenceAt } from "./cloud-control-evidence-helpers";

export function validateSupabasePrivateLinkPayload(
  id: string,
  value: Record<string, unknown>,
  opts: { expectedAwsTopology?: unknown; maxAgeMinutes?: number } = {},
): string[] {
  if (id !== "supabase-privatelink-prerequisite") return [];
  const payload = record(value.providerPayload);
  const trusted = trustedPrivateLink(opts.expectedAwsTopology);
  const errors: string[] = [];
  if (payload?.schemaVersion !== "supabase-privatelink-provider-payload@1") {
    errors.push(`${id}: missing Supabase PrivateLink provider payload evidence`);
  }
  if (payload?.evidenceMode === "evidence-only") {
    errors.push(...validateEvidenceOnlyPayload(id, payload, trusted));
  } else if (payload?.evidenceMode === "aws-side-automated") {
    errors.push(...validateAwsSidePayload(id, payload, trusted, opts.maxAgeMinutes ?? 60));
  } else {
    errors.push(`${id}: Supabase PrivateLink payload has unsupported evidence mode`);
  }
  return errors;
}

function validateEvidenceOnlyPayload(
  id: string,
  payload: Record<string, unknown> | undefined,
  trusted: TrustedPrivateLink | undefined,
): string[] {
  const errors: string[] = [];
  if (payload?.awsApiInputsPresent === true || trusted) {
    errors.push(`${id}: AWS-side PrivateLink API inputs cannot use support-only evidence`);
  }
  if (payload?.supportMediated !== true) {
    errors.push(`${id}: Supabase PrivateLink payload must retain support-mediated evidence`);
  }
  for (const field of [
    "supportEvidenceRef",
    "ramPermissionEvidenceRef",
    "latticePermissionEvidenceRef",
    "privateDnsEvidenceRef",
  ]) {
    if (typeof payload?.[field] !== "string" || !String(payload[field]).trim()) {
      errors.push(`${id}: Supabase PrivateLink payload missing ${field}`);
    }
  }
  return errors;
}

function validateAwsSidePayload(
  id: string,
  payload: Record<string, unknown> | undefined,
  trusted: TrustedPrivateLink | undefined,
  maxAgeMinutes: number,
) {
  const errors = validateSupportBoundary(id, payload);
  const expected = record(payload?.expected);
  const ram = record(payload?.ram);
  const lattice = record(payload?.lattice);
  const privateDns = record(payload?.privateDns);
  const psql = record(payload?.psql);
  const route = record(payload?.routeSecurityGroupPosture);
  const rule = record(route?.rule);
  if (!expected) errors.push(`${id}: missing AWS-side PrivateLink expected identity`);
  if (!trusted) {
    errors.push(`${id}: AWS-side PrivateLink automation requires selected topology evidence`);
  }
  if (trusted && text(expected, "accountId") !== trusted.accountId) {
    errors.push(`${id}: AWS-side PrivateLink account does not match selected topology`);
  }
  if (trusted && text(expected, "region") !== trusted.region) {
    errors.push(`${id}: AWS-side PrivateLink region does not match selected topology`);
  }
  if (text(ram, "ramShareArn") !== (trusted?.ramShareArn || text(expected, "ramShareArn"))) {
    errors.push(`${id}: RAM share ARN does not match selected PrivateLink evidence`);
  }
  if (text(ram, "ramShareStatus") !== "accepted") {
    errors.push(`${id}: AWS-side RAM share is not accepted`);
  }
  if (
    text(lattice, "resourceConfigurationArn") !==
    (trusted?.resourceConfigurationArn || text(expected, "resourceConfigurationArn"))
  ) {
    errors.push(`${id}: VPC Lattice resource configuration does not match selected evidence`);
  }
  if (!matchingLatticeIdentity(lattice, trusted || expected)) {
    errors.push(`${id}: VPC Lattice association does not match selected evidence`);
  }
  if (trusted && !matchingRoutePosture(route, rule, trusted)) {
    errors.push(`${id}: PrivateLink route/security-group posture does not match topology`);
  }
  if (privateDns?.enabled !== true || privateDns?.resolvesFromSelectedVpc !== true) {
    errors.push(`${id}: PrivateLink private DNS is not proven from selected VPC`);
  }
  if (!freshEvidenceAt(privateDns, { maxAgeMinutes })) {
    errors.push(`${id}: PrivateLink private DNS evidence is missing or stale`);
  }
  if (trusted && text(privateDns, "vpcId") !== trusted.vpcId) {
    errors.push(`${id}: PrivateLink private DNS VPC does not match selected topology`);
  }
  if (psql?.success !== true || !text(psql, "proofDigest").startsWith("sha256:")) {
    errors.push(`${id}: PrivateLink psql proof is missing or unsuccessful`);
  }
  if (!freshEvidenceAt(psql, { maxAgeMinutes })) {
    errors.push(`${id}: PrivateLink psql proof is missing or stale`);
  }
  if (trusted && text(psql, "vpcId") !== trusted.vpcId) {
    errors.push(`${id}: PrivateLink psql proof VPC does not match selected topology`);
  }
  if (!Array.isArray(payload?.mutationOutcomes) || payload.mutationOutcomes.length === 0) {
    errors.push(`${id}: missing AWS-side PrivateLink mutation outcome evidence`);
  }
  return errors;
}

function validateSupportBoundary(id: string, payload: Record<string, unknown> | undefined) {
  const errors: string[] = [];
  if (payload?.awsApiInputsPresent !== true) {
    errors.push(`${id}: AWS-side PrivateLink automation requires reviewed AWS API inputs`);
  }
  if (payload?.supportMediated !== true || !text(payload, "supportEvidenceRef")) {
    errors.push(`${id}: Supabase-side PrivateLink prerequisite must remain support-mediated`);
  }
  return errors;
}

function matchingLatticeIdentity(
  lattice: Record<string, unknown> | undefined,
  expected: Record<string, unknown> | TrustedPrivateLink | undefined,
) {
  const endpoint = text(expected, "endpointId");
  const association = text(expected, "serviceNetworkAssociationId");
  if (endpoint) return text(lattice, "endpointId") === endpoint;
  return !!association && text(lattice, "serviceNetworkAssociationId") === association;
}

function matchingRoutePosture(
  route: Record<string, unknown> | undefined,
  rule: Record<string, unknown> | undefined,
  trusted: TrustedPrivateLink,
) {
  const sources = new Set(list(rule, "sourceSecurityGroupIds"));
  return (
    text(route, "endpointSecurityGroupId") === trusted.endpointSecurityGroupId &&
    text(route, "serviceSecurityGroupId") === trusted.serviceSecurityGroupId &&
    text(route, "workerSecurityGroupId") === trusted.workerSecurityGroupId &&
    text(rule, "protocol").toLowerCase() === "tcp" &&
    rule?.port === 5432 &&
    text(rule, "destinationSecurityGroupId") === trusted.endpointSecurityGroupId &&
    sources.has(trusted.serviceSecurityGroupId) &&
    sources.has(trusted.workerSecurityGroupId)
  );
}

type TrustedPrivateLink = Record<string, unknown> & {
  accountId: string;
  region: string;
  vpcId: string;
  ramShareArn: string;
  resourceConfigurationArn: string;
  endpointSecurityGroupId: string;
  serviceSecurityGroupId: string;
  workerSecurityGroupId: string;
};

function trustedPrivateLink(topology: unknown): TrustedPrivateLink | undefined {
  const selected = record(topology);
  const database = record(selected?.database);
  const privatelink = record(database?.privatelink);
  if (database?.mode !== "privatelink" || !privatelink) return undefined;
  return {
    ...privatelink,
    accountId: text(selected, "accountId"),
    region: text(selected, "region"),
    vpcId: text(record(selected?.vpc), "id"),
    ramShareArn: text(privatelink, "ramShareArn"),
    resourceConfigurationArn: text(privatelink, "resourceConfigurationArn"),
    endpointSecurityGroupId: text(privatelink, "endpointSecurityGroupId"),
    serviceSecurityGroupId: text(privatelink, "serviceSecurityGroupId"),
    workerSecurityGroupId: text(privatelink, "workerSecurityGroupId"),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function text(value: Record<string, unknown> | undefined, field: string): string {
  const selected = value?.[field];
  return typeof selected === "string" ? selected.trim() : "";
}

function list(value: Record<string, unknown> | undefined, field: string): string[] {
  const selected = value?.[field];
  return Array.isArray(selected)
    ? selected.filter((item): item is string => typeof item === "string")
    : [];
}
