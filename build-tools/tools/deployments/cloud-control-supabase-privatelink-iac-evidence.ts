import type { AwsTopologyEvidence } from "./cloud-control-aws-topology-types";
import {
  SUPABASE_PRIVATELINK_IAC_PATHS,
  object,
  list,
  privateLinkCommonEvidenceErrors,
  privateLinkDirectMutationErrors,
  stableJson,
  text,
} from "./cloud-control-supabase-privatelink-iac-rules";

export const SUPABASE_PRIVATELINK_OPENTOFU_PLAN_SCHEMA = "supabase-privatelink-opentofu-plan@1";
export const SUPABASE_PRIVATELINK_OPENTOFU_APPLY_SCHEMA = "supabase-privatelink-opentofu-apply@1";
export const SUPABASE_PRIVATELINK_READONLY_SCHEMA = "supabase-privatelink-readonly-evidence@1";

export type SupabasePrivateLinkIacBundle = {
  plan?: Record<string, unknown>;
  apply?: Record<string, unknown>;
  readOnly?: Record<string, unknown>;
};

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;

export function validateSupabasePrivateLinkIacBundle(opts: {
  iac: SupabasePrivateLinkIacBundle;
  phase: string;
  topology?: AwsTopologyEvidence;
}): string[] {
  return [
    ...validatePlan(opts.iac.plan, opts.topology),
    ...requiresApply(opts.phase).flatMap(() => validateApply(opts.iac.apply, opts.iac.plan)),
    ...requiresReadOnly(opts.phase).flatMap(() =>
      validateReadOnly(opts.iac.readOnly, opts.iac.apply, opts.topology),
    ),
    ...privateLinkDirectMutationErrors(opts.iac),
  ];
}

export function summarizeSupabasePrivateLinkIac(iac: SupabasePrivateLinkIacBundle) {
  return {
    plan: summarize(iac.plan),
    apply: summarize(iac.apply),
    readOnly: summarize(iac.readOnly),
  };
}

function validatePlan(value: unknown, topology?: AwsTopologyEvidence): string[] {
  const plan = object(value);
  const errors = privateLinkCommonEvidenceErrors(
    "plan",
    plan,
    SUPABASE_PRIVATELINK_OPENTOFU_PLAN_SCHEMA,
    SUPABASE_PRIVATELINK_IAC_PATHS.plan,
  );
  if (text(plan, "source") !== "reviewed-opentofu-plan") {
    errors.push("PrivateLink IaC plan must come from reviewed OpenTofu plan");
  }
  errors.push(...digestErrors("plan", plan, ["planDigest"]));
  errors.push(...identityErrors("plan", plan, topology));
  errors.push(...resourcePostureErrors("plan", plan));
  const adoption = object(plan.importAdoption);
  if (!["managed", "imported"].includes(text(adoption, "mode"))) {
    errors.push("PrivateLink IaC plan requires import/adoption mode");
  }
  if (!text(adoption, "reviewedReference") || !text(adoption, "importBlock")) {
    errors.push("PrivateLink IaC plan requires reviewed import/adoption metadata");
  }
  return errors;
}

function validateApply(value: unknown, planValue: unknown): string[] {
  const apply = object(value);
  const plan = object(planValue);
  const errors = privateLinkCommonEvidenceErrors(
    "apply",
    apply,
    SUPABASE_PRIVATELINK_OPENTOFU_APPLY_SCHEMA,
    SUPABASE_PRIVATELINK_IAC_PATHS.apply,
  );
  if (text(apply, "source") !== "reviewed-opentofu-apply") {
    errors.push("PrivateLink IaC apply must come from reviewed OpenTofu apply");
  }
  errors.push(...digestErrors("apply", apply, ["planDigest", "applyDigest"]));
  if (text(apply, "planDigest") !== text(plan, "planDigest")) {
    errors.push("PrivateLink IaC apply plan digest does not match reviewed plan");
  }
  if (text(apply, "applyDigest") === text(apply, "planDigest")) {
    errors.push("PrivateLink IaC apply digest must be distinct from reviewed plan digest");
  }
  errors.push(...identityErrors("apply", apply));
  errors.push(...resourcePostureErrors("apply", apply));
  errors.push(...postureMatchErrors("apply", apply, plan, "reviewed plan"));
  return errors;
}

function validateReadOnly(value: unknown, applyValue: unknown, topology?: AwsTopologyEvidence) {
  const evidence = object(value);
  const apply = object(applyValue);
  const errors = privateLinkCommonEvidenceErrors(
    "read-only evidence",
    evidence,
    SUPABASE_PRIVATELINK_READONLY_SCHEMA,
    SUPABASE_PRIVATELINK_IAC_PATHS.readOnly,
  );
  if (text(evidence, "source") !== "aws-privatelink-readonly-inspection") {
    errors.push("PrivateLink evidence must be read-only AWS inspection");
  }
  errors.push(...digestErrors("read-only evidence", evidence, ["evidenceDigest"]));
  if (text(evidence, "evidenceDigest") === text(apply, "applyDigest")) {
    errors.push(
      "PrivateLink read-only evidence digest must be distinct from reviewed apply digest",
    );
  }
  errors.push(...identityErrors("read-only evidence", evidence, topology));
  errors.push(...resourcePostureErrors("read-only evidence", evidence));
  errors.push(...postureMatchErrors("read-only evidence", evidence, apply, "reviewed apply"));
  if (
    object(evidence.psql).success !== true ||
    !text(evidence, "psqlProofDigest").startsWith("sha256:")
  ) {
    errors.push("PrivateLink read-only evidence requires successful psql proof");
  }
  return errors;
}

function digestErrors(label: string, record: Record<string, unknown>, fields: string[]): string[] {
  return fields.flatMap((field) =>
    SHA256_DIGEST.test(text(record, field))
      ? []
      : [`PrivateLink IaC ${label} ${field} must be sha256:<64 hex> provenance`],
  );
}

function identityErrors(
  label: string,
  record: Record<string, unknown>,
  topology?: AwsTopologyEvidence,
): string[] {
  const expected = object(record.expected);
  const trusted =
    topology?.database?.mode === "privatelink" ? topology.database.privatelink : undefined;
  const errors: string[] = [];
  if (topology?.accountId && text(expected, "accountId") !== topology.accountId) {
    errors.push(`PrivateLink IaC ${label} account does not match trusted AWS topology`);
  }
  if (topology?.region && text(expected, "region") !== topology.region) {
    errors.push(`PrivateLink IaC ${label} region does not match trusted AWS topology`);
  }
  if (trusted?.ramShareArn && text(expected, "ramShareArn") !== trusted.ramShareArn) {
    errors.push(`PrivateLink IaC ${label} RAM share ARN does not match selected evidence`);
  }
  if (
    trusted?.resourceConfigurationArn &&
    text(expected, "resourceConfigurationArn") !== trusted.resourceConfigurationArn
  ) {
    errors.push(`PrivateLink IaC ${label} resource configuration does not match selected evidence`);
  }
  if (trusted && !matchingLatticeIdentity(record, trusted)) {
    errors.push(
      `PrivateLink IaC ${label} VPC Lattice association does not match selected evidence`,
    );
  }
  return errors;
}

function resourcePostureErrors(label: string, record: Record<string, unknown>): string[] {
  const ram = object(record.ram);
  const lattice = object(record.lattice);
  const dns = object(record.privateDns);
  const route = object(record.routeSecurityGroupPosture);
  const rule = object(route.rule);
  const errors: string[] = [];
  if (text(ram, "ramShareStatus") !== "accepted") {
    errors.push(`PrivateLink IaC ${label} RAM share is not accepted`);
  }
  if (!text(lattice, "resourceConfigurationArn") || !matchingLatticeIdentity(record, lattice)) {
    errors.push(
      `PrivateLink IaC ${label} requires VPC Lattice endpoint or service-network association`,
    );
  }
  if (dns.enabled !== true || dns.resolvesFromSelectedVpc !== true) {
    errors.push(`PrivateLink IaC ${label} private DNS is not proven from selected VPC`);
  }
  if (!matchingRoute(rule, route)) {
    errors.push(`PrivateLink IaC ${label} route/security-group posture is incomplete`);
  }
  return errors;
}

function postureMatchErrors(
  label: string,
  actualRecord: Record<string, unknown>,
  expectedRecord: Record<string, unknown>,
  expectedLabel: string,
): string[] {
  return ["expected", "ram", "lattice", "privateDns", "routeSecurityGroupPosture"].flatMap((key) =>
    stableJson(actualRecord[key]) === stableJson(expectedRecord[key])
      ? []
      : [`PrivateLink IaC ${label} ${key} does not match ${expectedLabel}`],
  );
}

function matchingLatticeIdentity(
  record: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  const lattice = object(record.lattice);
  const endpoint = text(expected, "endpointId");
  const association = text(expected, "serviceNetworkAssociationId");
  if (endpoint) return text(lattice, "endpointId") === endpoint;
  return !!association && text(lattice, "serviceNetworkAssociationId") === association;
}

function matchingRoute(rule: Record<string, unknown>, route: Record<string, unknown>): boolean {
  const sources = new Set(list(rule, "sourceSecurityGroupIds"));
  const service = text(route, "serviceSecurityGroupId");
  const worker = text(route, "workerSecurityGroupId");
  return (
    text(route, "endpointSecurityGroupId") !== "" &&
    text(rule, "protocol").toLowerCase() === "tcp" &&
    rule.port === 5432 &&
    text(rule, "destinationSecurityGroupId") === text(route, "endpointSecurityGroupId") &&
    sources.has(service) &&
    sources.has(worker)
  );
}

function requiresApply(phase: string) {
  return ["apply", "evidence", "smoke"].includes(phase) ? [true] : [];
}

function requiresReadOnly(phase: string) {
  return ["evidence", "smoke"].includes(phase) ? [true] : [];
}

function summarize(value: unknown) {
  const record = object(value);
  return {
    schemaVersion: text(record, "schemaVersion"),
    source: text(record, "source"),
    digest:
      text(record, "planDigest") || text(record, "applyDigest") || text(record, "evidenceDigest"),
    workingDirectory: text(record, "workingDirectory"),
  };
}
