import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import YAML from "yaml";

const CONFIG = "/etc/deployment-control-plane/config.yaml";
const CREDS = "/run/deployment-control-plane/credentials";
const STATE = "/var/lib/deployment-control-plane";

export function modeFiles(input: CloudControlSetupInput): Record<string, string> {
  if (input.mode === "aws-ec2") {
    return {
      "aws-ec2-profile.yaml": awsProfile(input),
      "systemd-podman.units.txt": systemdPodman(input),
    };
  }
  if (input.mode === "nixos") return { "nixos-module.example.nix": nixosExample(input) };
  if (input.mode === "saas-oci") return { "saas-oci-profile.yaml": saasProfile(input) };
  return { "compose.yaml": composeProfile(input) };
}

function composeProfile(input: CloudControlSetupInput): string {
  return [
    "x-control-plane-runtime:",
    "  uid: 10001",
    "  gid: 10001",
    "  ownedPaths:",
    `    - ${STATE}/records`,
    `    - ${STATE}/artifacts`,
    `    - ${STATE}/runtime`,
    "services:",
    serviceBlock(input),
    workerBlock(input, 1),
    workerBlock(input, 2),
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
    '    user: "10001:10001"',
    `    command: ["service", "--config", "${CONFIG}"]`,
    "    volumes:",
    `      - ./config.yaml:${CONFIG}:ro`,
    `      - ./credentials:${CREDS}:ro`,
    `      - control-plane-records:${STATE}/records`,
    `      - control-plane-artifacts:${STATE}/artifacts`,
    `      - control-plane-runtime:${STATE}/runtime`,
    `    ports: ["127.0.0.1:7780:7780"]`,
  ].join("\n");
}

function workerBlock(input: CloudControlSetupInput, index: number): string {
  return [
    `  deployment-control-plane-worker-${index}:`,
    `    image: ${input.image}`,
    '    user: "10001:10001"',
    `    command: ["worker", "--config", "${CONFIG}", "--worker-id", "worker-${index}"]`,
    "    volumes:",
    `      - ./config.yaml:${CONFIG}:ro`,
    `      - ./credentials:${CREDS}:ro`,
    `      - control-plane-records:${STATE}/records`,
    `      - control-plane-artifacts:${STATE}/artifacts`,
    `      - control-plane-runtime:${STATE}/runtime`,
  ].join("\n");
}

function nixosExample(input: CloudControlSetupInput): string {
  const infisicalCredentialSources = input.deploymentIds
    .flatMap((deploymentId) => [
      `      ${deploymentId}-infisical-client-id.source = "/run/secrets/${deploymentId}-infisical-client-id";`,
      `      ${deploymentId}-infisical-client-secret.source = "/run/secrets/${deploymentId}-infisical-client-secret";`,
    ])
    .join("\n");
  return `{
  services.viberoots.deploymentControlPlaneContainer = {
    enable = true;
    image = "${input.image}";
    instanceId = "${input.instanceId}";
    publicUrl = "${input.publicUrl}";
    workerReplicas = 2;
    infisicalDeploymentIds = [ ${input.deploymentIds.map((id) => `"${id}"`).join(" ")} ];
    artifactStore.bucket = "${input.artifactBucket}";
    credentials = {
      control-plane-database-url.source = "/run/secrets/control-plane-database-url";
      control-plane-token.source = "/run/secrets/control-plane-token";
      reviewed-source-ssh-key.source = "/run/secrets/reviewed-source-ssh-key";
      reviewed-source-known-hosts.source = "/run/secrets/reviewed-source-known-hosts";
      artifact-store-endpoint.source = "/run/secrets/artifact-store-endpoint";
      artifact-store-access-key-id.source = "/run/secrets/artifact-store-access-key-id";
      artifact-store-secret-access-key.source = "/run/secrets/artifact-store-secret-access-key";
${infisicalCredentialSources}
    };
  };
}`;
}

function saasProfile(input: CloudControlSetupInput): string {
  return YAML.stringify({
    schemaVersion: "cloud-control-saas-oci-profile@1",
    image: input.image,
    processes: processSpecs(input, "saas-oci"),
    mounts: mountSpecs("persistent-volume"),
    runtimeUser: { uid: 10001, gid: 10001 },
    protectedSharedReady: false,
    readinessEvidence: ["health", "readiness", "worker-heartbeats", "provider-capabilities"],
  });
}

function awsProfile(input: CloudControlSetupInput): string {
  const alternate =
    input.artifactBackend === "aws-s3"
      ? "none"
      : `${input.artifactBackend} with evidence ${input.artifactBackendEvidence}`;
  return YAML.stringify({
    schemaVersion: "cloud-control-aws-ec2-profile@1",
    artifactBackend: {
      selected: input.artifactBackend,
      defaultPath: "AWS S3 through a VPC endpoint",
      reviewedAlternateEvidence: alternate,
    },
    network: {
      subnetIds: input.awsSubnetIds,
      securityGroupIds: input.awsSecurityGroupIds,
      supabasePrivatelink: input.supabasePrivatelink,
    },
    systemdPodmanUnits: processSpecs(input, "aws-ec2"),
    mounts: mountSpecs("host-path"),
    runtimeUser: { uid: 10001, gid: 10001 },
    protectedSharedReady: false,
  });
}

function systemdPodman(input: CloudControlSetupInput): string {
  return `deployment-control-plane-service ${input.image} ${CONFIG} ${CREDS}
deployment-control-plane-worker-1 ${input.image} ${CONFIG} ${CREDS} ${STATE}/runtime
deployment-control-plane-worker-2 ${input.image} ${CONFIG} ${CREDS} ${STATE}/runtime
`;
}

type RenderedProcess = {
  name: string;
  image: string;
  command: string[];
  mounts: string[];
};

function processSpecs(input: CloudControlSetupInput, substrate: string): RenderedProcess[] {
  return [
    {
      name: "deployment-control-plane-service",
      image: input.image,
      command: ["service", "--config", CONFIG],
      mounts: mountedPaths(),
      ...(substrate === "aws-ec2"
        ? { systemdUnit: "deployment-control-plane-service.service" }
        : {}),
    },
    ...[1, 2].map((index) => ({
      name: `deployment-control-plane-worker-${index}`,
      image: input.image,
      command: ["worker", "--config", CONFIG, "--worker-id", `worker-${index}`],
      mounts: mountedPaths(),
      ...(substrate === "aws-ec2"
        ? { systemdUnit: `deployment-control-plane-worker-${index}.service` }
        : {}),
    })),
  ];
}

function mountSpecs(kind: string) {
  return mountedPaths().map((target) => ({
    kind,
    target,
    readOnly: target === CONFIG || target === CREDS,
  }));
}

function mountedPaths(): string[] {
  return [CONFIG, CREDS, `${STATE}/records`, `${STATE}/artifacts`, `${STATE}/runtime`];
}
