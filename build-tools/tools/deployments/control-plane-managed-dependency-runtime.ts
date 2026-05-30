#!/usr/bin/env zx-wrapper
import type {
  ControlPlaneManagedDependencyProfile,
  ManagedDependencyValidationExpectations,
  ManagedRuntimePathEvidence,
  ManagedRuntimePathFacts,
} from "./control-plane-managed-dependency-types";

export function runtimePathEvidence(
  profile: ControlPlaneManagedDependencyProfile,
  facts: ManagedRuntimePathFacts = {},
): ManagedRuntimePathEvidence {
  const runtime = profile.runtimePath;
  return {
    hostProfile: optionalText(facts.hostProfile),
    awsRegion: optionalText(facts.awsRegion),
    databaseConnectivityMode: runtime.databaseConnectivityMode,
    sourceHostIdentity: optionalText(facts.sourceHostIdentity),
    sourceHostKind: facts.sourceHostKind,
    nonCutoverDiagnostic: facts.nonCutoverDiagnostic || runtime.nonCutoverDiagnostic || undefined,
    supabaseProjectRef: optionalText(facts.supabaseProjectRef),
    supabaseRegion: optionalText(facts.supabaseRegion),
    privatelinkEndpointId: optionalText(facts.privatelinkEndpointId),
    privatelinkResourceId: optionalText(facts.privatelinkResourceId),
    s3VpcEndpointId: optionalText(facts.s3VpcEndpointId),
    s3EndpointPolicyDigest: optionalText(facts.s3EndpointPolicyDigest),
    alternateBackendEvidenceRef: optionalText(facts.alternateBackendEvidenceRef),
    alternateBackendEvidenceDigest: optionalText(facts.alternateBackendEvidenceDigest),
  };
}

export function validateRuntimePathEvidence(
  value: any,
  opts: ManagedDependencyValidationExpectations = {},
): string[] {
  const errors: string[] = [];
  const mode = value.databaseConnectivityMode;
  if (typeof value.hostProfile !== "string" || !value.hostProfile.trim()) {
    errors.push("managed dependency evidence missing runtime host profile");
  }
  if (typeof value.awsRegion !== "string" || !value.awsRegion.trim()) {
    errors.push("managed dependency evidence missing runtime AWS region");
  }
  if (mode !== "public" && mode !== "privatelink") {
    errors.push("managed dependency evidence has unsupported database connectivity mode");
  }
  if (opts.expectedDatabaseConnectivityMode && mode !== opts.expectedDatabaseConnectivityMode) {
    errors.push("managed dependency database connectivity mode does not match");
  }
  if (opts.expectedHostProfile && value.hostProfile !== opts.expectedHostProfile) {
    errors.push("managed dependency runtime host profile does not match");
  }
  if (opts.expectedRegion && value.awsRegion !== opts.expectedRegion) {
    errors.push("managed dependency runtime AWS region does not match");
  }
  if (opts.expectedSupabaseRegion && value.supabaseRegion !== opts.expectedSupabaseRegion) {
    errors.push("managed dependency Supabase region does not match");
  }
  if (
    opts.expectedHostProfile === "aws-ec2" &&
    !value.nonCutoverDiagnostic &&
    value.sourceHostKind !== "aws-ec2"
  ) {
    errors.push("AWS runtime-path evidence must come from the AWS EC2 runtime path");
  }
  if (
    opts.expectedHostProfile === "aws-ec2" &&
    !value.nonCutoverDiagnostic &&
    !value.sourceHostIdentity
  ) {
    errors.push("AWS runtime-path evidence missing source host identity");
  }
  if (mode === "privatelink") {
    if (!value.sourceHostIdentity) errors.push("PrivateLink evidence missing source host identity");
    if (!value.nonCutoverDiagnostic && value.sourceHostKind !== "aws-ec2") {
      errors.push("PrivateLink cutover evidence must come from the AWS EC2 runtime path");
    }
    compareExpectedPrivateLinkIdentity(errors, value, opts, "PrivateLink");
  }
  return errors;
}

export function validatePostgresRuntimeEvidence(
  postgres: any,
  runtime: any,
  opts: ManagedDependencyValidationExpectations = {},
): string[] {
  const errors: string[] = [];
  if (postgres.databaseConnectivityMode !== runtime.databaseConnectivityMode) {
    errors.push("managed Postgres evidence database mode does not match runtime path");
  }
  if (!postgres.tlsEnabled) errors.push("managed Postgres evidence missing TLS proof");
  if (runtime.sourceHostIdentity && postgres.sourceHostIdentity !== runtime.sourceHostIdentity) {
    errors.push("managed Postgres evidence source host identity does not match runtime path");
  }
  if (runtime.sourceHostKind && postgres.sourceHostKind !== runtime.sourceHostKind) {
    errors.push("managed Postgres evidence source host kind does not match runtime path");
  }
  if (runtime.databaseConnectivityMode === "privatelink") {
    if (isPublicSupabaseHost(postgres.resolvedHost)) {
      errors.push("PrivateLink mode cannot use a public Supabase database hostname");
    }
    if (!postgres.privatelinkEndpointId && !postgres.privatelinkResourceId) {
      errors.push("PrivateLink evidence missing endpoint or resource identity");
    }
  }
  const actualProjectRef = text(postgres.supabaseProjectRef) || text(runtime.supabaseProjectRef);
  compareExpected(
    errors,
    actualProjectRef,
    opts.expectedSupabaseProjectRef,
    "managed Postgres Supabase project ref",
  );
  compareExpected(
    errors,
    text(postgres.supabaseRegion) || text(runtime.supabaseRegion),
    opts.expectedSupabaseRegion,
    "managed Postgres Supabase region",
  );
  compareExpectedPrivateLinkIdentity(errors, postgres, opts, "managed Postgres PrivateLink");
  return errors;
}

export function validateArtifactRuntimeEvidence(
  artifactStore: any,
  runtime: any,
  opts: ManagedDependencyValidationExpectations = {},
): string[] {
  const errors: string[] = [];
  if (artifactStore.provider === "aws-s3") {
    if (!artifactStore.s3VpcEndpointId && !artifactStore.s3EndpointPolicyDigest) {
      errors.push("AWS S3 evidence missing VPC endpoint proof");
    }
    if (artifactStore.region !== runtime.awsRegion) {
      errors.push("AWS S3 evidence region does not match runtime AWS region");
    }
    compareExpected(
      errors,
      artifactStore.s3VpcEndpointId || runtime.s3VpcEndpointId,
      opts.expectedS3VpcEndpointId,
      "AWS S3 VPC endpoint id",
    );
    compareExpected(
      errors,
      artifactStore.s3EndpointPolicyDigest || runtime.s3EndpointPolicyDigest,
      opts.expectedS3EndpointPolicyDigest,
      "AWS S3 endpoint policy digest",
    );
    return errors;
  }
  const awsRuntimePath =
    runtime.hostProfile === "aws-ec2" || opts.expectedHostProfile === "aws-ec2";
  if (
    awsRuntimePath &&
    (!artifactStore.alternateBackendEvidenceRef || !artifactStore.alternateBackendEvidenceDigest)
  ) {
    errors.push("alternate artifact backend evidence is required for AWS runtime path");
  }
  compareExpected(
    errors,
    artifactStore.alternateBackendEvidenceRef || runtime.alternateBackendEvidenceRef,
    opts.expectedAlternateBackendEvidenceRef,
    "alternate artifact backend evidence reference",
  );
  compareExpected(
    errors,
    artifactStore.alternateBackendEvidenceDigest || runtime.alternateBackendEvidenceDigest,
    opts.expectedAlternateBackendEvidenceDigest,
    "alternate artifact backend evidence digest",
  );
  return errors;
}

function isPublicSupabaseHost(host: string): boolean {
  return /\.supabase\.co$/i.test(host) || /\.pooler\.supabase\.com$/i.test(host);
}

function compareExpected(
  errors: string[],
  actual: unknown,
  expected: string | undefined,
  label: string,
): void {
  if (!expected) return;
  const actualText = text(actual);
  if (!actualText) {
    errors.push(`${label} proof is missing`);
    return;
  }
  if (actualText !== expected) errors.push(`${label} does not match expected value`);
}

function compareExpectedPrivateLinkIdentity(
  errors: string[],
  actual: any,
  opts: ManagedDependencyValidationExpectations,
  label: string,
): void {
  if (opts.expectedPrivateLinkEndpointId) {
    compareExpected(
      errors,
      actual.privatelinkEndpointId,
      opts.expectedPrivateLinkEndpointId,
      `${label} endpoint id`,
    );
    return;
  }
  compareExpected(
    errors,
    actual.privatelinkResourceId,
    opts.expectedPrivateLinkResourceId,
    `${label} resource identity`,
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  return text || undefined;
}
