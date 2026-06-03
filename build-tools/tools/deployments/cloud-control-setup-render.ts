import YAML from "yaml";
import {
  capabilityDeclaration,
  CLOUD_CAPABILITY_IDS,
  CREDENTIAL_FILENAMES,
  GITHUB_APP_FILENAMES,
  INFISICAL_FILENAMES,
  SSH_REVIEWED_SOURCE_FILENAMES,
} from "./cloud-control-setup-contract";
import type {
  CloudControlSetupInput,
  ProviderCapabilityDeclaration,
} from "./cloud-control-setup-types";
import {
  renderConformanceChecklist,
  renderIngressChecklist,
  renderManagedDependencies,
  renderManagedDependencyProfile,
  renderSupabasePostgresProfile,
} from "./cloud-control-setup-artifacts";
import { renderCommands } from "./cloud-control-runbook";
import { modeFiles } from "./cloud-control-setup-profiles";
import { assertCloudControlSetupInput } from "./cloud-control-setup-validate";
import { verifiedControlPlaneImageDigestContract } from "./control-plane-image-publication";
import { artifactCredentialFiles } from "./control-plane-artifact-credential-mode";
import { setupArtifactCredentialMode } from "./cloud-control-setup-aws-topology";
import { runtimeAuthConfig, type RuntimeInput } from "./cloud-control-runtime-input";
import { renderCredentialMap } from "./cloud-control-credential-map";
import { renderResidualActionChecklist } from "./cloud-control-residual-actions";
import { renderPrivateLinkOpenTofuFiles } from "./cloud-control-setup-privatelink-iac";
import { renderEcrIacEvidence, renderEcrOpenTofuFiles } from "./cloud-control-setup-ecr-iac";
import { renderEc2AsgOpenTofuFiles } from "./cloud-control-setup-ec2-asg-iac";
import { renderPrivateLinkPsqlHelper } from "./cloud-control-setup-privatelink-psql-helper";

export type CloudControlSetupBundle = {
  files: Record<string, string>;
  capabilities: ProviderCapabilityDeclaration[];
};

export function renderCloudControlSetupBundle(
  input: CloudControlSetupInput,
): CloudControlSetupBundle {
  assertCloudControlSetupInput(input);
  const runtimeInput = setupRuntimeInput(input);
  const requiredCredentials = credentialFiles(input);
  const capabilities = CLOUD_CAPABILITY_IDS.map((id) =>
    capabilityDeclaration(id, { deploymentLabel: input.deploymentIds[0] }),
  );
  const files = {
    "config.yaml": renderRuntimeConfig(input, runtimeInput),
    "credential-manifest.json": renderCredentialManifest(input, requiredCredentials),
    "runtime-input.yaml": YAML.stringify(runtimeInput),
    "auth-provider-profile.json": `${JSON.stringify(runtimeInput.authProvider, null, 2)}\n`,
    "credential-map.json": renderCredentialMap(input, requiredCredentials),
    "residual-action-checklist.json": renderResidualActionChecklist(input),
    "commands.json": renderCommands(input),
    "image-publication.json": renderImagePublication(input),
    ...(input.imagePublication?.registryProfile
      ? { "registry-profile.json": renderRegistryProfile(input) }
      : {}),
    ...renderEcrOpenTofuFiles(input),
    ...renderEcrIacEvidence(input),
    ...renderPrivateLinkOpenTofuFiles(input),
    ...renderEc2AsgOpenTofuFiles(input),
    ...renderPrivateLinkPsqlHelper(input),
    "conformance-checklist.json": renderConformanceChecklist(input),
    "managed-dependencies.profile.yaml": renderManagedDependencyProfile(input),
    "managed-dependencies.json": renderManagedDependencies(input),
    "supabase-postgres.profile.json": renderSupabasePostgresProfile(input),
    "ingress-checklist.json": renderIngressChecklist(input),
    "provider-capabilities.json": `${JSON.stringify(capabilities, null, 2)}\n`,
    ...(input.awsTopology
      ? { "aws-topology-evidence.json": `${JSON.stringify(input.awsTopology, null, 2)}\n` }
      : {}),
    "README.md": renderReadme(input),
    ...modeFiles(input),
  };
  return { files, capabilities };
}

function setupRuntimeInput(input: CloudControlSetupInput): RuntimeInput {
  if (!input.runtimeInput) throw new Error("cloud control-plane setup requires runtime input");
  return input.runtimeInput;
}

function renderRuntimeConfig(input: CloudControlSetupInput, runtimeInput: RuntimeInput): string {
  return YAML.stringify({
    instanceId: input.instanceId,
    mode: "protected-shared",
    processMode: "fully-enabled",
    service: {
      host: "0.0.0.0",
      port: 7780,
      publicUrl: input.publicUrl,
      tokenFile: cred("control-plane-token"),
    },
    workers: { expectedCount: input.workerReplicas },
    storage: {
      recordsRoot: "/var/lib/deployment-control-plane/records",
      artifactStagingRoot: "/var/lib/deployment-control-plane/artifacts",
      runtimeRoot: "/var/lib/deployment-control-plane/runtime",
      artifactStore: {
        kind: "s3-compatible",
        provider: input.artifactBackend,
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
      },
    },
    database: { urlFile: cred("control-plane-database-url") },
    credentials: {
      directory: "/run/deployment-control-plane/credentials",
      defaults: {
        infisicalClientIdFilePattern: "{deploymentId}-infisical-client-id",
        infisicalClientSecretFilePattern: "{deploymentId}-infisical-client-secret",
      },
      infisicalDeployments: runtimeInput.infisicalDeployments.map((entry) => ({
        deploymentId: entry.deploymentId,
        siteUrl: entry.siteUrl,
        projectId: entry.projectId,
        environment: entry.environment,
      })),
    },
    reviewedSource: reviewedSource(input),
    webUi: { enabled: true, basePath: "/" },
    mcp: { enabled: true, basePath: "/mcp" },
    authProvider: runtimeAuthConfig(runtimeInput.authProvider),
  });
}

function renderCredentialManifest(input: CloudControlSetupInput, requiredFiles: string[]): string {
  return `${JSON.stringify(
    {
      schemaVersion: "cloud-control-credential-manifest@1",
      credentialDirectory: "/run/deployment-control-plane/credentials",
      reviewedSourceMode: input.reviewedSourceMode,
      deploymentIds: input.deploymentIds,
      requiredFiles,
      placeholdersOnly: false,
      credentialMap: "credential-map.json",
      rejectedSources: [
        "ambient environment",
        "CI environment",
        "image layers",
        "registry metadata",
      ],
    },
    null,
    2,
  )}\n`;
}

function credentialFiles(input: CloudControlSetupInput): string[] {
  const artifact = new Set(artifactCredentialFiles(setupArtifactCredentialMode(input)));
  const reviewed =
    input.reviewedSourceMode === "github-app"
      ? [...GITHUB_APP_FILENAMES]
      : [...SSH_REVIEWED_SOURCE_FILENAMES];
  return [
    ...CREDENTIAL_FILENAMES.filter(
      (name) => !name.startsWith("artifact-store-") || artifact.has(name),
    ),
    ...input.deploymentIds.flatMap((deploymentId) =>
      INFISICAL_FILENAMES.map((name) => name.replace("{deploymentId}", deploymentId)),
    ),
    ...reviewed,
  ];
}

function renderReadme(input: CloudControlSetupInput): string {
  return [
    "# Cloud Control Plane Profile",
    "",
    `Mode: \`${input.mode}\``,
    `Image: \`${input.image}\``,
    "Image publication evidence: `image-publication.json`",
    "",
    "This bundle contains reviewed non-secret runtime metadata, structured evidence references,",
    "and mounted file paths only. Provider dashboards, raw IaC state, and support-mediated actions",
    "are evidence inputs; they are not hidden deployment authority. Protected/shared readiness is",
    "blocked until every selected provider capability has validation evidence.",
    "",
    "Run `control-plane setup-doctor --bundle-dir <bundle> --out <bundle>/setup-doctor.json`",
    "`control-plane credential-preflight --bundle-dir <bundle> --out <bundle>/credential-preflight.json`,",
    "and `control-plane credential-staging --bundle-dir <bundle> --out <bundle>/credential-staging.json`",
    "before starting the service and workers. `commands.json` is the ordered runbook for the",
    "remaining checks.",
  ].join("\n");
}

function renderImagePublication(input: CloudControlSetupInput): string {
  const evidence = input.imagePublication!;
  return `${JSON.stringify(
    {
      schemaVersion: "cloud-control-image-publication@1",
      ...evidence,
      digestContract: verifiedControlPlaneImageDigestContract(evidence),
    },
    null,
    2,
  )}\n`;
}

function renderRegistryProfile(input: CloudControlSetupInput): string {
  return `${JSON.stringify(input.imagePublication!.registryProfile, null, 2)}\n`;
}

function reviewedSource(input: CloudControlSetupInput) {
  if (input.reviewedSourceMode === "github-app") {
    return {
      mode: "github-app",
      githubAppIdFile: cred("reviewed-source-github-app-id"),
      githubAppInstallationIdFile: cred("reviewed-source-github-app-installation-id"),
      githubAppPrivateKeyFile: cred("reviewed-source-github-app-private-key"),
    };
  }
  return {
    mode: "ssh",
    sshKeyFile: cred("reviewed-source-ssh-key"),
    sshKnownHostsFile: cred("reviewed-source-known-hosts"),
  };
}

function cred(name: string): string {
  return `/run/deployment-control-plane/credentials/${name}`;
}
