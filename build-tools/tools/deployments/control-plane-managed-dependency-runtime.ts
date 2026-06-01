#!/usr/bin/env zx-wrapper
import type {
  ControlPlaneManagedDependencyProfile,
  ManagedDependencyValidationExpectations,
  ManagedRuntimePathEvidence,
  ManagedRuntimePathFacts,
} from "./control-plane-managed-dependency-types";
import {
  compareExpected,
  compareExpectedPrivateLinkIdentity,
  isPublicSupabaseHost,
  roleNameFromArn,
  text,
} from "./control-plane-managed-dependency-runtime-validation-helpers";

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
    expectedArtifactIamRoleArn: optionalText(facts.artifactIamRoleArn),
    expectedArtifactLeastPrivilegePolicyDigest: optionalText(
      facts.artifactLeastPrivilegePolicyDigest,
    ),
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
    const expectsInstanceProfileArtifact =
      Boolean(opts.expectedArtifactIamRoleArn) ||
      Boolean(opts.expectedArtifactLeastPrivilegePolicyDigest);
    if (
      expectsInstanceProfileArtifact &&
      artifactStore.artifactCredentialMode !== "aws-instance-profile"
    ) {
      errors.push("AWS S3 evidence missing aws-instance-profile artifact credential mode");
    }
    if (
      artifactStore.artifactCredentialMode === "aws-instance-profile" ||
      expectsInstanceProfileArtifact
    ) {
      compareExpected(
        errors,
        artifactStore.expectedArtifactIamRoleArn || runtime.expectedArtifactIamRoleArn,
        opts.expectedArtifactIamRoleArn,
        "AWS S3 artifact IAM role",
      );
      compareExpected(
        errors,
        artifactStore.artifactLeastPrivilegePolicyDigest ||
          runtime.expectedArtifactLeastPrivilegePolicyDigest,
        opts.expectedArtifactLeastPrivilegePolicyDigest,
        "AWS S3 least-privilege policy digest",
      );
      if (!artifactStore.expectedArtifactIamRoleArn) {
        errors.push("AWS S3 evidence missing expected IAM role proof");
      }
      if (!artifactStore.observedArtifactIamRoleName) {
        errors.push("AWS S3 evidence missing observed runtime IAM role identity");
      } else if (
        artifactStore.expectedArtifactIamRoleArn &&
        roleNameFromArn(artifactStore.expectedArtifactIamRoleArn) !==
          artifactStore.observedArtifactIamRoleName
      ) {
        errors.push("AWS S3 observed runtime IAM role does not match expected role");
      }
      if (!artifactStore.artifactLeastPrivilegePolicyDigest) {
        errors.push("AWS S3 evidence missing least-privilege bucket/prefix policy proof");
      }
    }
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

function optionalText(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  return text || undefined;
}
