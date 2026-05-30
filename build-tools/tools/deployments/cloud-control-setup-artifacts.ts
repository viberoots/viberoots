import YAML from "yaml";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";

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
          commandRef: "commands.json#/phases/4/commands/0/command",
          passCondition: "HTTP 200 from /healthz with reviewed image digest metadata",
        },
        {
          name: "readiness",
          commandRef: "commands.json#/phases/4/commands/1/command",
          passCondition: "HTTP 200 from /readyz after database and artifact-store checks",
        },
        {
          name: "worker-heartbeats",
          commandRef: "commands.json#/phases/4/commands/2/command",
          passCondition: `${input.workerReplicas} workers visible with fresh heartbeat rows`,
        },
        {
          name: "database",
          commandRef: "commands.json#/phases/2/commands/0/command",
          passCondition: "managed Postgres SQL feature conformance succeeds",
        },
        {
          name: "artifact-store",
          commandRef: "commands.json#/phases/2/commands/1/command",
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
    postgres: {
      provider: "supabase-postgres",
      urlFile: cred("control-plane-database-url"),
    },
    artifactStore: {
      provider: artifactProvider(input),
      bucket: input.artifactBucket,
      region: input.artifactRegion,
      endpointFile: cred("artifact-store-endpoint"),
      accessKeyIdFile: cred("artifact-store-access-key-id"),
      secretAccessKeyFile: cred("artifact-store-secret-access-key"),
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
        urlCredentialFile: "/run/deployment-control-plane/credentials/control-plane-database-url",
        privateConnectivity:
          input.mode === "aws-ec2" && input.supabasePrivatelink
            ? "supabase-privatelink-prerequisite"
            : "public-tls",
        requiredEvidence: ["feature conformance", "restore check", "backup policy"],
      },
      artifactStore: {
        backend: input.artifactBackend,
        bucket: input.artifactBucket,
        region: input.artifactRegion,
        endpointCredentialFile: "/run/deployment-control-plane/credentials/artifact-store-endpoint",
        defaultAwsPath:
          input.mode === "aws-ec2" && input.artifactBackend === "aws-s3"
            ? "aws-s3-vpc-endpoint"
            : undefined,
        reviewedAlternateEvidence:
          input.mode === "aws-ec2" && input.artifactBackend !== "aws-s3"
            ? input.artifactBackendEvidence
            : undefined,
        requiredEvidence: ["PUT/GET/HEAD conformance", "digest verification", "temporary prefix"],
      },
    },
    null,
    2,
  )}\n`;
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
        subnetEvidence: input.awsSubnetIds,
        securityGroupEvidence: input.awsSecurityGroupIds,
        tlsAlbOrNlbEvidence: input.tlsEvidence || "<required>",
        dnsEvidence: input.tlsEvidence ? "covered-by-tls-evidence" : "<required>",
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

function artifactProvider(input: CloudControlSetupInput): string {
  return input.artifactBackend === "supabase-storage-s3" ? "supabase-storage-s3" : "s3-compatible";
}
