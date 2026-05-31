import {
  evidenceList,
  evidenceObject,
  evidenceText,
  freshEvidenceAt,
  type EvidenceFreshnessOptions,
} from "./cloud-control-evidence-helpers";

export type SupabasePrivateLinkValidationOptions = EvidenceFreshnessOptions & {
  awsAccountId?: string;
  awsRegion?: string;
  vpcId?: string;
  serviceSecurityGroupId?: string;
  workerSecurityGroupId?: string;
  privateLinkSecurityGroupId?: string;
};

export function validateSupabasePrivateLinkEvidence(
  value: unknown,
  opts: SupabasePrivateLinkValidationOptions,
): string[] {
  const evidence = evidenceObject(value);
  return [
    ...requireFresh(value, "Supabase PrivateLink", opts),
    ...validateIdentity(evidence, opts),
    ...validateRegionalAvailability(evidence.regionalAvailability, evidence, opts),
    ...validateRam(evidence, opts),
    ...validateLattice(evidence, opts),
    ...validatePrivateDns(evidence.privateDns, opts),
    ...validateEndpointAddresses(evidence),
    ...validateSecurityGroupIdentities(evidence, opts),
    ...validateSecurityGroupRule(evidence.securityGroupRuleProof, opts),
    ...validatePsql(evidence.psql, evidence, opts),
    ...validateHostname(evidence.databaseUrl, opts),
    ...validatePublicConnectivity(evidence.publicConnectivity, opts),
  ];
}

function validateIdentity(
  value: Record<string, unknown>,
  opts: SupabasePrivateLinkValidationOptions,
) {
  const errors: string[] = [];
  if (!/^[a-z0-9-]+$/i.test(evidenceText(value, "supabaseProjectRef"))) {
    errors.push("missing Supabase PrivateLink project ref evidence");
  }
  const supabaseRegion = evidenceText(value, "supabaseRegion");
  if (!supabaseRegion) errors.push("missing Supabase PrivateLink Supabase region evidence");
  if (opts.awsRegion && supabaseRegion && supabaseRegion !== opts.awsRegion) {
    errors.push("Supabase PrivateLink Supabase region does not match AWS region");
  }
  if (opts.awsAccountId && evidenceText(value, "awsAccountId") !== opts.awsAccountId) {
    errors.push("Supabase PrivateLink AWS account id does not match topology");
  }
  if (opts.awsRegion && evidenceText(value, "awsRegion") !== opts.awsRegion) {
    errors.push("Supabase PrivateLink AWS region does not match topology");
  }
  if (!evidenceText(value, "resourceConfigurationArn")) {
    errors.push("missing Supabase PrivateLink resourceConfigurationArn evidence");
  }
  return errors;
}

function validateRegionalAvailability(
  value: unknown,
  parent: Record<string, unknown>,
  opts: EvidenceFreshnessOptions,
) {
  const evidence = evidenceObject(value);
  const errors = requireFresh(value, "Supabase PrivateLink regional availability", opts);
  if (evidence.available !== true) {
    errors.push("Supabase PrivateLink regional availability is not confirmed");
  }
  if (evidenceText(evidence, "region") !== evidenceText(parent, "supabaseRegion")) {
    errors.push("Supabase PrivateLink regional availability region does not match");
  }
  if (!evidenceText(evidence, "reviewedReference")) {
    errors.push("Supabase PrivateLink regional availability missing reviewed reference");
  }
  return errors;
}

function validateRam(value: Record<string, unknown>, opts: SupabasePrivateLinkValidationOptions) {
  const errors: string[] = [];
  if (!evidenceText(value, "ramShareArn"))
    errors.push("missing Supabase PrivateLink RAM share evidence");
  if (evidenceText(value, "ramShareStatus") !== "accepted") {
    errors.push("Supabase PrivateLink RAM share is not accepted");
  }
  errors.push(...validateReviewedPermission(value.ramPermission, "RAM acceptance", opts));
  return errors;
}

function validateLattice(
  value: Record<string, unknown>,
  opts: SupabasePrivateLinkValidationOptions,
) {
  const errors: string[] = [];
  if (!evidenceText(value, "endpointId") && !evidenceText(value, "serviceNetworkAssociationId")) {
    errors.push("missing Supabase PrivateLink endpoint or service-network association evidence");
  }
  errors.push(...validateReviewedPermission(value.latticePermission, "VPC Lattice wiring", opts));
  return errors;
}

function validatePrivateDns(value: unknown, opts: SupabasePrivateLinkValidationOptions) {
  const evidence = evidenceObject(value);
  const errors = requireFresh(value, "Supabase PrivateLink private DNS", opts);
  if (evidence.enabled !== true || evidence.resolvesFromSelectedVpc !== true) {
    errors.push("Supabase PrivateLink private DNS is not proven from selected VPC");
  }
  if (opts.vpcId && evidenceText(evidence, "vpcId") !== opts.vpcId) {
    errors.push("Supabase PrivateLink private DNS VPC does not match topology");
  }
  if (!evidenceText(evidence, "hostname")) {
    errors.push("Supabase PrivateLink private DNS missing hostname evidence");
  }
  return errors;
}

function validateEndpointAddresses(value: Record<string, unknown>) {
  const errors: string[] = [];
  if (evidenceList(value, "endpointDnsNames").length === 0) {
    errors.push("missing Supabase PrivateLink endpoint DNS evidence");
  }
  if (evidenceList(value, "endpointIps").length === 0) {
    errors.push("missing Supabase PrivateLink endpoint IP evidence");
  }
  return errors;
}

function validateSecurityGroupIdentities(
  value: Record<string, unknown>,
  opts: SupabasePrivateLinkValidationOptions,
) {
  const errors: string[] = [];
  const expected = [
    ["endpoint", "endpointSecurityGroupId", opts.privateLinkSecurityGroupId],
    ["service", "serviceSecurityGroupId", opts.serviceSecurityGroupId],
    ["worker", "workerSecurityGroupId", opts.workerSecurityGroupId],
  ] as const;
  for (const [label, field, id] of expected) {
    const actual = evidenceText(value, field);
    if (!actual) errors.push(`missing Supabase PrivateLink ${label} security-group identity`);
    else if (id && actual !== id) {
      errors.push(`Supabase PrivateLink ${label} security-group identity does not match topology`);
    }
  }
  return errors;
}

function validateSecurityGroupRule(value: unknown, opts: SupabasePrivateLinkValidationOptions) {
  const evidence = evidenceObject(value);
  const errors = requireFresh(value, "Supabase PrivateLink TCP 5432 security-group rule", opts);
  if (evidenceText(evidence, "protocol").toLowerCase() !== "tcp" || evidence.port !== 5432) {
    errors.push("Supabase PrivateLink security-group proof must be TCP 5432");
  }
  if (evidenceText(evidence, "destinationSecurityGroupId") !== opts.privateLinkSecurityGroupId) {
    errors.push("Supabase PrivateLink security-group proof has wrong endpoint security group");
  }
  const sources = new Set(evidenceList(evidence, "sourceSecurityGroupIds"));
  for (const id of [opts.serviceSecurityGroupId, opts.workerSecurityGroupId].filter(Boolean)) {
    if (!sources.has(id!))
      errors.push(
        "Supabase PrivateLink security-group proof missing selected service/worker source",
      );
  }
  return errors;
}

function validatePsql(
  value: unknown,
  parent: Record<string, unknown>,
  opts: SupabasePrivateLinkValidationOptions,
) {
  const evidence = evidenceObject(value);
  const errors = requireFresh(value, "Supabase PrivateLink psql", opts);
  if (evidence.success !== true || !evidenceText(parent, "psqlProofDigest").startsWith("sha256:")) {
    errors.push("Supabase PrivateLink psql proof is missing or unsuccessful");
  }
  if (
    evidenceText(evidence, "sourceHostKind") !== "aws-ec2" ||
    !evidenceText(evidence, "sourceHostIdentity")
  ) {
    errors.push("Supabase PrivateLink psql proof must come from selected AWS EC2 VPC path");
  }
  if (opts.vpcId && evidenceText(evidence, "vpcId") !== opts.vpcId) {
    errors.push("Supabase PrivateLink psql proof VPC does not match topology");
  }
  return errors;
}

function validateHostname(value: unknown, opts: EvidenceFreshnessOptions) {
  const evidence = evidenceObject(value);
  const errors = requireFresh(value, "Supabase PrivateLink database URL hostname", opts);
  const hostname = evidenceText(evidence, "hostname");
  if (!hostname || isPublicSupabaseHost(hostname) || evidence.classification !== "private") {
    errors.push("PrivateLink mode cannot use a public Supabase database hostname");
  }
  return errors;
}

function validatePublicConnectivity(value: unknown, opts: EvidenceFreshnessOptions) {
  const evidence = evidenceObject(value);
  const errors = requireFresh(value, "Supabase public database connectivity status", opts);
  const status = evidenceText(evidence, "status");
  if (!["retained", "disabled"].includes(status)) {
    errors.push("missing Supabase public database connectivity status");
  }
  if (status === "retained" && !evidenceText(evidence, "retainedPublicPathJustification")) {
    errors.push("retained Supabase public database connectivity lacks reviewed justification");
  }
  if (status === "disabled" && evidence.privatePathClientsPassed !== true) {
    errors.push(
      "Supabase public database connectivity disabled before private-path clients passed",
    );
  }
  return errors;
}

function validateReviewedPermission(value: unknown, label: string, opts: EvidenceFreshnessOptions) {
  const evidence = evidenceObject(value);
  const errors = requireFresh(value, `Supabase PrivateLink ${label} permission`, opts);
  if (
    !evidenceText(evidence, "reviewedReference") ||
    !evidenceText(evidence, "digest").startsWith("sha256:")
  ) {
    errors.push(`missing Supabase PrivateLink ${label} permission evidence`);
  }
  return errors;
}

function requireFresh(value: unknown, label: string, opts: EvidenceFreshnessOptions): string[] {
  return freshEvidenceAt(value, opts) ? [] : [`${label} evidence is missing or stale`];
}

function isPublicSupabaseHost(host: string): boolean {
  return /\.supabase\.co$/i.test(host) || /\.pooler\.supabase\.com$/i.test(host);
}
