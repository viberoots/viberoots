import YAML from "yaml";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { awsTopologyRequiredCapabilityIds } from "./cloud-control-aws-topology-capabilities";
import {
  setupArtifactBackendEvidenceRef,
  setupArtifactCredentialMode,
  setupAwsTopology,
  setupAwsSecurityGroupIds,
  setupAwsSubnetIds,
  setupAwsTlsEvidenceRef,
  setupUsesSupabasePrivateLink,
} from "./cloud-control-setup-aws-topology";

const CREDENTIAL_DIR = "/run/deployment-control-plane/credentials";

export function renderConformanceChecklist(input: CloudControlSetupInput): string {
  return `${JSON.stringify(
    {
      schemaVersion: "cloud-control-conformance-checklist@1",
      requiredChecks: [
        {
          name: "image-publication",
          commandRef: "image-publication.json",
          passCondition: "registry inspection digest matches the host-profile image reference",
        },
        {
          name: "health",
          commandRef: "commands.json#/phases/4/commands/4/command",
          passCondition: "HTTP 200 from /healthz with reviewed image digest metadata",
        },
        {
          name: "readiness",
          commandRef: "commands.json#/phases/4/commands/5/command",
          passCondition: "HTTP 200 from /readyz after database and artifact-store checks",
        },
        {
          name: "worker-heartbeats",
          commandRef: "commands.json#/phases/4/commands/6/command",
          passCondition: `${input.workerReplicas} workers visible with fresh heartbeat rows`,
        },
        {
          name: "database",
          commandRef: managedCommandRef(managedDependencyCheckIndex(input)),
          passCondition: "managed Postgres SQL feature conformance succeeds",
        },
        {
          name: "artifact-store",
          commandRef: managedCommandRef(managedDependencyCheckIndex(input) + 1),
          passCondition: "temporary object PUT/GET/HEAD and digest verification succeeds",
        },
        {
          name: "provider-capabilities",
          commandRef: "provider-capabilities.json",
          passCondition:
            "every selected component has audit evidence and protected/shared eligibility",
        },
      ],
    },
    null,
    2,
  )}\n`;
}

export function renderManagedDependencyProfile(input: CloudControlSetupInput): string {
  return YAML.stringify({
    profileName: input.instanceId,
    compatibilityEvidenceFile: "./managed-dependency-evidence.json",
    supabasePostgresEvidenceFile: "./supabase-managed-postgres-evidence.json",
    runtimePath: runtimePath(input),
    supabasePostgres: supabaseProfile(input),
    postgres: {
      provider: "supabase-postgres",
      urlFile: cred("control-plane-database-url"),
    },
    artifactStore: {
      provider: artifactProvider(input),
      credentialMode: setupArtifactCredentialMode(input),
      bucket: input.artifactBucket,
      region: input.artifactRegion,
      endpointFile: cred("artifact-store-endpoint"),
      ...(setupArtifactCredentialMode(input) === "files"
        ? {
            accessKeyIdFile: cred("artifact-store-access-key-id"),
            secretAccessKeyFile: cred("artifact-store-secret-access-key"),
          }
        : {}),
      keyPrefix: `${input.instanceId}/conformance`,
    },
  });
}

export function renderManagedDependencies(input: CloudControlSetupInput): string {
  return `${JSON.stringify(
    {
      schemaVersion: "cloud-control-managed-dependencies@1",
      postgres: {
        profile: "managed-postgres",
        candidate: "supabase-managed-postgres",
        supabaseProfile: "supabase-postgres.profile.json",
        urlCredentialFile: "/run/deployment-control-plane/credentials/control-plane-database-url",
        privateConnectivity:
          input.mode === "aws-ec2" && setupUsesSupabasePrivateLink(input)
            ? "supabase-privatelink-prerequisite"
            : "public-tls",
        requiredEvidence: [
          "feature conformance",
          "plan and region capability",
          "organization/project access",
          "migration readiness",
          "restore check",
          "backup policy",
        ],
      },
      artifactStore: {
        backend: input.artifactBackend,
        credentialMode: setupArtifactCredentialMode(input),
        bucket: input.artifactBucket,
        region: input.artifactRegion,
        endpointCredentialFile: "/run/deployment-control-plane/credentials/artifact-store-endpoint",
        defaultAwsPath:
          input.mode === "aws-ec2" && input.artifactBackend === "aws-s3"
            ? "aws-s3-vpc-endpoint"
            : undefined,
        reviewedAlternateEvidence:
          input.mode === "aws-ec2" && input.artifactBackend !== "aws-s3"
            ? setupArtifactBackendEvidenceRef(input)
            : undefined,
        requiredEvidence: ["PUT/GET/HEAD conformance", "digest verification", "temporary prefix"],
        iamRoleArn: input.artifactIamRoleArn,
        leastPrivilegePolicyDigest: input.artifactLeastPrivilegePolicyDigest,
      },
    },
    null,
    2,
  )}\n`;
}

export function renderSupabasePostgresProfile(input: CloudControlSetupInput): string {
  return `${JSON.stringify(supabaseProfile(input), null, 2)}\n`;
}

export function renderIngressChecklist(input: CloudControlSetupInput): string {
  return `${JSON.stringify(
    {
      schemaVersion: "cloud-control-ingress-checklist@1",
      serviceIngress: {
        publicUrl: input.publicUrl,
        requiredBoundary: "HTTPS to deployment-control-plane service only",
        health: "/healthz",
        readiness: "/readyz",
        workerHeartbeats: "/api/v1/worker-heartbeats",
      },
      authCallback: {
        host: input.authCallbackHost,
        path: input.authCallbackPath,
        requiredBoundary: "identity-provider callback to control-plane service",
      },
      awsEc2: {
        subnetEvidence: setupAwsSubnetIds(input),
        securityGroupEvidence: setupAwsSecurityGroupIds(input),
        tlsAlbOrNlbEvidence: setupAwsTlsEvidenceRef(input) || "<required>",
        dnsEvidence: setupAwsTlsEvidenceRef(input) ? "covered-by-tls-evidence" : "<required>",
        generatedEvidenceCommands: [
          "commands.json#/phases/5/commands/0",
          "commands.json#/phases/5/commands/1",
          "commands.json#/phases/5/commands/2",
          "commands.json#/phases/5/commands/3",
        ],
      },
      unsupportedMutationHosts: [
        "vercel-functions",
        "supabase-edge-functions",
        "cloudflare-workers",
        "fargate-without-file-backed-credential-evidence",
      ],
    },
    null,
    2,
  )}\n`;
}

function cred(name: string): string {
  return `${CREDENTIAL_DIR}/${name}`;
}

function managedCommandRef(index: number): string {
  return `commands.json#/phases/2/commands/${index}/command`;
}

function managedDependencyCheckIndex(input: CloudControlSetupInput): number {
  const providerEvidenceCount = input.awsTopology
    ? awsTopologyRequiredCapabilityIds(input.awsTopology).filter(
        (id) => id !== "supabase-managed-postgres",
      ).length
    : 0;
  const privateLinkEvidenceCount = setupUsesSupabasePrivateLink(input) ? 6 : 0;
  return 1 + providerEvidenceCount + privateLinkEvidenceCount;
}

function artifactProvider(input: CloudControlSetupInput): string {
  return input.artifactBackend;
}

function runtimePath(input: CloudControlSetupInput) {
  const topology = setupAwsTopology(input);
  const database = topology?.database;
  const privatelink = database?.mode === "privatelink" ? database.privatelink : undefined;
  return {
    expectedHostProfile: input.mode,
    expectedAwsRegion: topology?.region || input.artifactRegion,
    databaseConnectivityMode: database?.mode || "public",
    expectedSupabaseProjectRef: privatelink?.supabaseProjectRef,
    expectedSupabaseRegion: privatelink?.supabaseRegion,
    expectedPrivateLinkEndpointId: privatelink?.endpointId,
    expectedPrivateLinkResourceId: privatelink?.resourceConfigurationArn,
    expectedS3VpcEndpointId: topology?.s3VpcEndpoint?.endpointId,
    expectedS3EndpointPolicyDigest: topology?.s3VpcEndpoint?.endpointPolicyDigest,
    expectedArtifactIamRoleArn: input.artifactIamRoleArn,
    expectedArtifactLeastPrivilegePolicyDigest: input.artifactLeastPrivilegePolicyDigest,
    expectedAlternateBackendEvidenceRef: topology?.artifactBackendEvidence?.reviewedReference,
    expectedAlternateBackendEvidenceDigest: topology?.artifactBackendEvidence?.digest,
  };
}

function supabaseProfile(input: CloudControlSetupInput) {
  if (input.supabasePostgres) return input.supabasePostgres;
  throw new Error("cloud control-plane setup requires --supabase-postgres-profile");
}
