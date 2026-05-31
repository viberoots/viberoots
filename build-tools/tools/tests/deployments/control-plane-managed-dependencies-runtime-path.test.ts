#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManagedDependencyProfile } from "../../deployments/control-plane-managed-dependency-profiles";
import { runtimePathEvidence } from "../../deployments/control-plane-managed-dependency-runtime";
import { validateManagedDependencyEvidence } from "../../deployments/control-plane-managed-dependency-validation";
import {
  baseArtifactStore,
  basePostgres,
  baseRuntimePath,
  evidence,
  profileYaml,
} from "./control-plane-managed-dependencies-runtime-path.fixture";

test("managed dependency profile parses public and PrivateLink runtime expectations", () => {
  const publicProfile = parseManagedDependencyProfile(profileYaml("public"), {
    credentialDirectory: "/run/deployment-control-plane/credentials",
  });
  assert.equal(publicProfile.runtimePath.databaseConnectivityMode, "public");

  const privateProfile = parseManagedDependencyProfile(profileYaml("privatelink"), {
    credentialDirectory: "/run/deployment-control-plane/credentials",
  });
  assert.equal(privateProfile.runtimePath.expectedPrivateLinkEndpointId, "vpce-privatelink123");
  assert.equal(privateProfile.runtimePath.expectedAlternateBackendEvidenceRef, "reviewed-alt");
  assert.throws(
    () =>
      parseManagedDependencyProfile(
        profileYaml("public").replace(
          "databaseConnectivityMode: public",
          "databaseConnectivityMode: dashboard",
        ),
        { credentialDirectory: "/run/deployment-control-plane/credentials" },
      ),
    /runtimePath\.databaseConnectivityMode/,
  );
});

test("PrivateLink managed dependency evidence fails closed for public host and laptop proof", () => {
  const errors = validateManagedDependencyEvidence(
    evidence({
      runtimePath: {
        ...baseRuntimePath(),
        sourceHostIdentity: "laptop.local",
        sourceHostKind: "unknown",
      },
      postgres: {
        ...basePostgres(),
        resolvedHost: "db.projectref.supabase.co",
        privatelinkEndpointId: "vpce-privatelink123",
      },
    }),
    60,
    { expectedHostProfile: "aws-ec2", expectedRegion: "us-east-1" },
  ).join("\n");
  assert.match(errors, /AWS EC2 runtime path/);
  assert.match(errors, /public Supabase database hostname/);
});

test("PrivateLink diagnostic evidence is explicit non-cutover proof", () => {
  const result = validateManagedDependencyEvidence(
    evidence({
      runtimePath: {
        ...baseRuntimePath(),
        sourceHostIdentity: "laptop.local",
        sourceHostKind: "unknown",
        nonCutoverDiagnostic: true,
      },
      postgres: {
        ...basePostgres(),
        sourceHostIdentity: "laptop.local",
        sourceHostKind: "unknown",
      },
    }),
    60,
    { expectedHostProfile: "aws-ec2", expectedRegion: "us-east-1" },
  );
  assert.deepEqual(result, []);
});

test("runtime host profile must be observed rather than copied from profile expectations", () => {
  const profile = parseManagedDependencyProfile(profileYaml("privatelink"), {
    credentialDirectory: "/run/deployment-control-plane/credentials",
  });
  const runtime = runtimePathEvidence(profile, {
    sourceHostIdentity: "i-0abc1234",
    sourceHostKind: "aws-ec2",
    awsRegion: "us-east-1",
    privatelinkEndpointId: "vpce-privatelink123",
    s3VpcEndpointId: "vpce-123",
  });
  assert.equal(runtime.hostProfile, undefined);

  const errors = validateManagedDependencyEvidence(
    evidence({
      runtimePath: {
        ...baseRuntimePath(),
        hostProfile: undefined,
      },
    }),
    60,
    { expectedHostProfile: "aws-ec2" },
  ).join("\n");
  assert.match(errors, /missing runtime host profile/);
});

test("runtime-path validation rejects wrong region, project, endpoint, and TLS proof", () => {
  const errors = validateManagedDependencyEvidence(
    evidence({
      runtimePath: { ...baseRuntimePath(), awsRegion: "us-west-2", supabaseProjectRef: "expected" },
      postgres: {
        ...basePostgres(),
        tlsEnabled: false,
        supabaseProjectRef: "actual",
        privatelinkEndpointId: "",
      },
    }),
    60,
    {
      expectedHostProfile: "aws-ec2",
      expectedRegion: "us-east-1",
      expectedSupabaseProjectRef: "expected",
      expectedPrivateLinkEndpointId: "vpce-privatelink123",
    },
  ).join("\n");
  assert.match(errors, /runtime AWS region does not match/);
  assert.match(errors, /TLS proof/);
  assert.match(errors, /endpoint or resource identity/);
  assert.match(errors, /PrivateLink endpoint id proof is missing/);
  assert.match(errors, /Supabase project ref does not match/);
});

test("AWS runtime-path evidence fails closed when source host identity is missing", () => {
  const errors = validateManagedDependencyEvidence(
    evidence({
      runtimePath: {
        ...baseRuntimePath(),
        sourceHostIdentity: undefined,
      },
      postgres: {
        ...basePostgres(),
        sourceHostIdentity: undefined,
      },
      artifactStore: {
        ...baseArtifactStore(),
        sourceHostIdentity: undefined,
      },
    }),
    60,
    { expectedHostProfile: "aws-ec2" },
  ).join("\n");
  assert.match(errors, /source host identity/);
});

test("managed dependency evidence compares expected PrivateLink and S3 endpoint identities", () => {
  const errors = validateManagedDependencyEvidence(
    evidence({
      runtimePath: { ...baseRuntimePath(), privatelinkEndpointId: "vpce-other" },
      postgres: { ...basePostgres(), privatelinkEndpointId: "vpce-other" },
      artifactStore: { ...baseArtifactStore(), s3VpcEndpointId: "vpce-other-s3" },
    }),
    60,
    {
      expectedPrivateLinkEndpointId: "vpce-privatelink123",
      expectedS3VpcEndpointId: "vpce-123",
    },
  ).join("\n");
  assert.match(errors, /PrivateLink endpoint id does not match expected value/);
  assert.match(errors, /managed Postgres PrivateLink endpoint id does not match expected value/);
  assert.match(errors, /AWS S3 VPC endpoint id does not match expected value/);
});

test("managed dependency evidence rejects S3 runtime proof that contains secret material", () => {
  const errors = validateManagedDependencyEvidence(
    evidence({
      artifactStore: {
        ...baseArtifactStore(),
        s3EndpointPolicyDigest: "aws_secret_access_key=abcdefghijklmnopqrstuvwxyz123456",
      },
    }),
    60,
  ).join("\n");
  assert.match(errors, /appears to contain secret material/);
});

test("expected Supabase project evidence fails closed when missing", () => {
  const errors = validateManagedDependencyEvidence(
    evidence({
      runtimePath: { ...baseRuntimePath(), supabaseProjectRef: undefined },
      postgres: { ...basePostgres(), supabaseProjectRef: undefined },
    }),
    60,
    { expectedSupabaseProjectRef: "projectref" },
  ).join("\n");
  assert.match(errors, /managed Postgres Supabase project ref proof is missing/);
});

test("AWS S3 managed dependency evidence requires VPC endpoint proof", () => {
  const errors = validateManagedDependencyEvidence(
    evidence({
      artifactStore: {
        ...baseArtifactStore(),
        s3VpcEndpointId: "",
        s3EndpointPolicyDigest: "",
      },
    }),
    60,
  ).join("\n");
  assert.match(errors, /AWS S3 evidence missing VPC endpoint proof/);
});

test("alternate artifact backend evidence is required and compared on AWS runtime path", () => {
  const missing = validateManagedDependencyEvidence(
    evidence({
      artifactStore: {
        ...baseArtifactStore(),
        provider: "cloudflare-r2",
        region: "auto",
        s3VpcEndpointId: undefined,
      },
    }),
    60,
  ).join("\n");
  assert.match(missing, /alternate artifact backend evidence is required/);

  const wrong = validateManagedDependencyEvidence(
    evidence({
      artifactStore: {
        ...baseArtifactStore(),
        provider: "cloudflare-r2",
        region: "auto",
        s3VpcEndpointId: undefined,
        alternateBackendEvidenceRef: "reviewed-alt",
        alternateBackendEvidenceDigest: "sha256:wrong",
      },
    }),
    60,
    {
      expectedAlternateBackendEvidenceRef: "reviewed-alt",
      expectedAlternateBackendEvidenceDigest: "sha256:alternate",
    },
  ).join("\n");
  assert.match(wrong, /alternate artifact backend evidence digest does not match expected value/);
});
