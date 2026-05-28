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
  renderCommands,
  renderConformanceChecklist,
  renderIngressChecklist,
  renderManagedDependencies,
  renderManagedDependencyProfile,
} from "./cloud-control-setup-artifacts";
import { modeFiles } from "./cloud-control-setup-profiles";
import { assertCloudControlSetupInput } from "./cloud-control-setup-validate";
import { verifiedControlPlaneImageDigestContract } from "./control-plane-image-publication";

export type CloudControlSetupBundle = {
  files: Record<string, string>;
  capabilities: ProviderCapabilityDeclaration[];
};

export function renderCloudControlSetupBundle(
  input: CloudControlSetupInput,
): CloudControlSetupBundle {
  assertCloudControlSetupInput(input);
  const capabilities = CLOUD_CAPABILITY_IDS.map((id) => capabilityDeclaration(id));
  const files = {
    "config.yaml": renderRuntimeConfig(input),
    "credential-manifest.json": renderCredentialManifest(input),
    "commands.json": renderCommands(input),
    "image-publication.json": renderImagePublication(input),
    "conformance-checklist.json": renderConformanceChecklist(input),
    "managed-dependencies.profile.yaml": renderManagedDependencyProfile(input),
    "managed-dependencies.json": renderManagedDependencies(input),
    "ingress-checklist.json": renderIngressChecklist(input),
    "provider-capabilities.json": `${JSON.stringify(capabilities, null, 2)}\n`,
    "README.md": renderReadme(input),
    ...modeFiles(input),
  };
  return { files, capabilities };
}

function renderRuntimeConfig(input: CloudControlSetupInput): string {
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
    storage: {
      recordsRoot: "/var/lib/deployment-control-plane/records",
      artifactStagingRoot: "/var/lib/deployment-control-plane/artifacts",
      runtimeRoot: "/var/lib/deployment-control-plane/runtime",
      artifactStore: {
        kind: "s3-compatible",
        bucket: input.artifactBucket,
        region: input.artifactRegion,
        endpointFile: cred("artifact-store-endpoint"),
        accessKeyIdFile: cred("artifact-store-access-key-id"),
        secretAccessKeyFile: cred("artifact-store-secret-access-key"),
      },
    },
    database: { urlFile: cred("control-plane-database-url") },
    credentials: {
      directory: "/run/deployment-control-plane/credentials",
      defaults: {
        infisicalClientIdFilePattern: "{deploymentId}-infisical-client-id",
        infisicalClientSecretFilePattern: "{deploymentId}-infisical-client-secret",
      },
      infisicalDeployments: input.deploymentIds.map((deploymentId) => ({
        deploymentId,
        siteUrl: "https://app.infisical.com",
        projectId: `${deploymentId}-infisical-project`,
        environment: "production",
      })),
    },
    reviewedSource: reviewedSource(input),
    webUi: { enabled: true, basePath: "/" },
    mcp: { enabled: true, basePath: "/mcp" },
    authProvider: {
      kind: "generic-oidc-jwks",
      issuer: "https://auth.example.test",
      audience: ["deployments-control-plane"],
      jwksUrl: "https://auth.example.test/.well-known/jwks.json",
      callback: { externalHost: input.authCallbackHost, externalPath: input.authCallbackPath },
    },
  });
}

function renderCredentialManifest(input: CloudControlSetupInput): string {
  const reviewed =
    input.reviewedSourceMode === "github-app"
      ? [...GITHUB_APP_FILENAMES]
      : [...SSH_REVIEWED_SOURCE_FILENAMES];
  return `${JSON.stringify(
    {
      schemaVersion: "cloud-control-credential-manifest@1",
      credentialDirectory: "/run/deployment-control-plane/credentials",
      requiredFiles: [
        ...CREDENTIAL_FILENAMES,
        ...input.deploymentIds.flatMap((deploymentId) =>
          INFISICAL_FILENAMES.map((name) => name.replace("{deploymentId}", deploymentId)),
        ),
        ...reviewed,
      ],
      placeholdersOnly: true,
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

function renderReadme(input: CloudControlSetupInput): string {
  return [
    "# Cloud Control Plane Profile",
    "",
    `Mode: \`${input.mode}\``,
    `Image: \`${input.image}\``,
    "Image publication evidence: `image-publication.json`",
    "",
    "This bundle contains placeholders and mounted file paths only. Provider dashboards, raw IaC",
    "state, and support-mediated actions are evidence inputs; they are not hidden deployment",
    "authority. Protected/shared readiness is blocked until every selected provider capability has",
    "validation evidence.",
    "",
    "Review `provider-capabilities.json`, `credential-manifest.json`, and `commands.json` before",
    "starting the service and workers.",
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
