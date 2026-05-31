import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import YAML from "yaml";
import { renderAwsEc2ProfileFiles } from "./cloud-control-aws-ec2-host-profile";
import {
  CONTROL_PLANE_CONFIG,
  CONTROL_PLANE_CREDS,
  CONTROL_PLANE_GID,
  CONTROL_PLANE_STATE,
  CONTROL_PLANE_UID,
  controlPlaneMetadataEnv,
  controlPlaneMountSpecs,
  controlPlaneProcessSpecs,
  workerIndexes,
} from "./cloud-control-process-contract";
import { runtimeAuthConfig } from "./cloud-control-runtime-input";
import { setupArtifactCredentialMode } from "./cloud-control-setup-aws-topology";

export function modeFiles(input: CloudControlSetupInput): Record<string, string> {
  if (input.mode === "aws-ec2") return renderAwsEc2ProfileFiles(input);
  if (input.mode === "nixos") return { "nixos-module.example.nix": nixosExample(input) };
  if (input.mode === "saas-oci") return { "saas-oci-profile.yaml": saasProfile(input) };
  return { "compose.yaml": composeProfile(input) };
}

function composeProfile(input: CloudControlSetupInput): string {
  return [
    "x-control-plane-runtime:",
    `  uid: ${CONTROL_PLANE_UID}`,
    `  gid: ${CONTROL_PLANE_GID}`,
    "  ownedPaths:",
    `    - ${CONTROL_PLANE_STATE}/records`,
    `    - ${CONTROL_PLANE_STATE}/artifacts`,
    `    - ${CONTROL_PLANE_STATE}/runtime`,
    "services:",
    serviceBlock(input),
    ...workerIndexes(input).map((index) => workerBlock(input, index)),
    "volumes:",
    "  control-plane-records: {}",
    "  control-plane-artifacts: {}",
    "  control-plane-runtime: {}",
  ].join("\n");
}

function serviceBlock(input: CloudControlSetupInput): string {
  return [
    "  deployment-control-plane-service:",
    `    image: ${input.image}`,
    `    user: "${CONTROL_PLANE_UID}:${CONTROL_PLANE_GID}"`,
    `    command: ["service", "--config", "${CONTROL_PLANE_CONFIG}"]`,
    metadataEnvironment(input),
    "    volumes:",
    `      - ./config.yaml:${CONTROL_PLANE_CONFIG}:ro`,
    `      - ./credentials:${CONTROL_PLANE_CREDS}:ro`,
    `      - control-plane-records:${CONTROL_PLANE_STATE}/records`,
    `      - control-plane-artifacts:${CONTROL_PLANE_STATE}/artifacts`,
    `      - control-plane-runtime:${CONTROL_PLANE_STATE}/runtime`,
    `    ports: ["127.0.0.1:7780:7780"]`,
  ].join("\n");
}

function workerBlock(input: CloudControlSetupInput, index: number): string {
  return [
    `  deployment-control-plane-worker-${index}:`,
    `    image: ${input.image}`,
    `    user: "${CONTROL_PLANE_UID}:${CONTROL_PLANE_GID}"`,
    `    command: ["worker", "--config", "${CONTROL_PLANE_CONFIG}", "--worker-id", "worker-${index}"]`,
    metadataEnvironment(input),
    "    volumes:",
    `      - ./config.yaml:${CONTROL_PLANE_CONFIG}:ro`,
    `      - ./credentials:${CONTROL_PLANE_CREDS}:ro`,
    `      - control-plane-records:${CONTROL_PLANE_STATE}/records`,
    `      - control-plane-artifacts:${CONTROL_PLANE_STATE}/artifacts`,
    `      - control-plane-runtime:${CONTROL_PLANE_STATE}/runtime`,
  ].join("\n");
}

function nixosExample(input: CloudControlSetupInput): string {
  const infisicalCredentialSources = input.deploymentIds
    .flatMap((deploymentId) => [
      `      ${deploymentId}-infisical-client-id.source = "/run/secrets/${deploymentId}-infisical-client-id";`,
      `      ${deploymentId}-infisical-client-secret.source = "/run/secrets/${deploymentId}-infisical-client-secret";`,
    ])
    .join("\n");
  const reviewedSourceCredentialSources =
    input.reviewedSourceMode === "github-app"
      ? `      reviewed-source-github-app-id.source = "/run/secrets/reviewed-source-github-app-id";
      reviewed-source-github-app-installation-id.source = "/run/secrets/reviewed-source-github-app-installation-id";
      reviewed-source-github-app-private-key.source = "/run/secrets/reviewed-source-github-app-private-key";`
      : `      reviewed-source-ssh-key.source = "/run/secrets/reviewed-source-ssh-key";
      reviewed-source-known-hosts.source = "/run/secrets/reviewed-source-known-hosts";`;
  const artifactCredentialSources =
    setupArtifactCredentialMode(input) === "files"
      ? `      artifact-store-access-key-id.source = "/run/secrets/artifact-store-access-key-id";
      artifact-store-secret-access-key.source = "/run/secrets/artifact-store-secret-access-key";`
      : "";
  const auth = runtimeAuthConfig((input.runtimeInput ?? missingRuntimeInput()).authProvider);
  return `{
  services.viberoots.deploymentControlPlaneContainer = {
    enable = true;
    image = "${input.image}";
    imageSourceRevision = "${input.imagePublication!.sourceRevision}";
    imageBuildIdentity = "${input.expectedImageBuildIdentity}";
    imageInspectedDigest = "${input.imagePublication!.inspectedDigest}";
    imageTag = "${input.imagePublication!.tag}";
    imageDigestStatus = "verified-registry-publication";
    instanceId = "${input.instanceId}";
    publicUrl = "${input.publicUrl}";
    reviewedSourceMode = "${input.reviewedSourceMode}";
    authProvider = {
      kind = "${auth.kind}";
      issuer = "${auth.issuer}";
      audience = [ ${auth.audience.map((item) => `"${item}"`).join(" ")} ];
      jwksUrl = "${auth.jwksUrl || ""}";
      callback.externalHost = "${auth.callback.externalHost}";
      callback.externalPath = "${auth.callback.externalPath}";
      claims.userIdClaim = "${auth.claims.userIdClaim}";
      claims.emailClaim = "${auth.claims.emailClaim}";
      claims.roleClaim = "${auth.claims.roleClaim}";
      claims.servicePrincipalClaim = "${auth.claims.servicePrincipalClaim}";
      roleGroups.deployer = [ ${auth.roleGroups.deployer.map((item) => `"${item}"`).join(" ")} ];
      roleGroups.admissionReporter = [ ${auth.roleGroups.admissionReporter.map((item) => `"${item}"`).join(" ")} ];
      roleGroups.admin = [ ${auth.roleGroups.admin.map((item) => `"${item}"`).join(" ")} ];
      servicePrincipals = { ${Object.entries(auth.servicePrincipals)
        .map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)};`)
        .join(" ")} };
    };
    workerReplicas = 2;
    infisicalDeploymentIds = [ ${input.deploymentIds.map((id) => `"${id}"`).join(" ")} ];
    artifactStore.bucket = "${input.artifactBucket}";
    artifactStore.provider = "${input.artifactBackend}";
    artifactStore.credentialMode = "${setupArtifactCredentialMode(input)}";
    credentials = {
      control-plane-database-url.source = "/run/secrets/control-plane-database-url";
      control-plane-token.source = "/run/secrets/control-plane-token";
${reviewedSourceCredentialSources}
      artifact-store-endpoint.source = "/run/secrets/artifact-store-endpoint";
${artifactCredentialSources}
${infisicalCredentialSources}
    };
  };
}`;
}

function missingRuntimeInput(): never {
  throw new Error("cloud control-plane setup requires runtime input");
}

function saasProfile(input: CloudControlSetupInput): string {
  return YAML.stringify({
    schemaVersion: "cloud-control-saas-oci-profile@1",
    image: input.image,
    processes: controlPlaneProcessSpecs(input),
    imagePublication: input.imagePublication,
    mounts: controlPlaneMountSpecs("persistent-volume"),
    runtimeUser: { uid: CONTROL_PLANE_UID, gid: CONTROL_PLANE_GID },
    protectedSharedReady: false,
    readinessEvidence: ["health", "readiness", "worker-heartbeats", "provider-capabilities"],
  });
}

function metadataEnvironment(input: CloudControlSetupInput): string {
  return [
    "    environment:",
    ...controlPlaneMetadataEnv(input).map(
      ([key, value]) => `      ${key}: ${JSON.stringify(value)}`,
    ),
  ].join("\n");
}
