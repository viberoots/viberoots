import { readFileSync } from "node:fs";
import YAML from "yaml";
import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import {
  CONTROL_PLANE_GID,
  CONTROL_PLANE_UID,
  controlPlaneMountSpecs,
  controlPlaneProcessSpecs,
  type RenderedControlPlaneProcess,
} from "./cloud-control-process-contract";
import {
  setupArtifactBackendEvidenceRef,
  setupAwsSecurityGroupIds,
  setupAwsSubnetIds,
  setupUsesSupabasePrivateLink,
} from "./cloud-control-setup-aws-topology";
import { podmanRun, systemdUnit, userDataScript } from "./cloud-control-aws-ec2-systemd";

export const REQUIRED_AWS_EC2_ALARMS = [
  "service-down",
  "readiness-failure",
  "missing-worker-heartbeat",
  "queue-backlog",
  "repeated-worker-crash",
] as const;

export function renderAwsEc2ProfileFiles(input: CloudControlSetupInput): Record<string, string> {
  const processes = controlPlaneProcessSpecs(input);
  return {
    "aws-ec2-profile.yaml": awsProfile(input, processes),
    ...Object.fromEntries(processes.map((process) => [unitPath(process), systemdUnit(process)])),
    "aws-ec2-podman-run.sh": podmanRun(processes),
    "nixos/aws-ec2-control-plane-host.example.nix": nixosEc2Example(input),
    "nixos/deployment-control-plane-container-module.nix": nixSource(
      "deployment-control-plane-container-module.nix",
    ),
    "nixos/deployment-control-plane-container-defaults.nix": nixSource(
      "deployment-control-plane-container-defaults.nix",
    ),
    "nixos/deployment-control-plane-container-config.nix": nixSource(
      "deployment-control-plane-container-config.nix",
    ),
    "aws-ec2-observability-profile.json": observabilityProfile(input, processes),
    "aws-ec2-host-profile-evidence.contract.json": evidenceContract(input, processes),
    "aws-ec2-user-data.sh": userDataScript(processes),
  };
}

function awsProfile(input: CloudControlSetupInput, processes: RenderedControlPlaneProcess[]) {
  const alternate =
    input.artifactBackend === "aws-s3"
      ? "none"
      : `${input.artifactBackend} with evidence ${setupArtifactBackendEvidenceRef(input)}`;
  return YAML.stringify({
    schemaVersion: "cloud-control-aws-ec2-profile@2",
    preferredHost: "nixos-ec2",
    compatibilityHost: "systemd-podman",
    artifactBackend: {
      selected: input.artifactBackend,
      defaultPath: "AWS S3 through a VPC endpoint",
      reviewedAlternateEvidence: alternate,
    },
    network: {
      subnetIds: setupAwsSubnetIds(input),
      securityGroupIds: setupAwsSecurityGroupIds(input),
      supabasePrivatelink: setupUsesSupabasePrivateLink(input),
    },
    compute: computeProfile(input),
    systemdUnits: processes.map((process) => process.systemdUnit),
    podmanRunScript: "aws-ec2-podman-run.sh",
    nixosModuleExample: "nixos/aws-ec2-control-plane-host.example.nix",
    processes,
    imagePublication: input.imagePublication,
    registryProfile: input.imagePublication?.registryProfile,
    mounts: controlPlaneMountSpecs("host-path"),
    runtimeUser: { uid: CONTROL_PLANE_UID, gid: CONTROL_PLANE_GID },
    observabilityProfile: "aws-ec2-observability-profile.json",
    hostProfileEvidenceContract: "aws-ec2-host-profile-evidence.contract.json",
    protectedSharedReady: false,
  });
}

function computeProfile(input: CloudControlSetupInput) {
  const compute = (input.awsTopology as any)?.compute || {};
  return {
    amiId: compute.amiId,
    amiBuildIdentity: compute.amiBuildIdentity,
    amiPinPath: compute.amiSelection?.pinPath,
    launchTemplateId: compute.launchTemplateId,
    launchTemplateVersion: compute.launchTemplateVersion,
    selectedSubnetIds: compute.launchTemplateSubnetIds || compute.autoScalingGroupSubnetIds || [],
    instanceProfileArn: compute.instanceProfileArn,
    recoveryMode: compute.recovery?.mode,
    accessMode: compute.access?.mode,
    ebsEncrypted: compute.ebs?.encrypted,
    hostImagePatchCadence: compute.patchCadence?.hostImage,
    containerImagePatchCadence: compute.patchCadence?.containerImage,
  };
}

function nixosEc2Example(input: CloudControlSetupInput): string {
  const infisicalCredentials = input.deploymentIds
    .flatMap((id) => [
      `      ${id}-infisical-client-id.source = "/run/secrets/${id}-infisical-client-id";`,
      `      ${id}-infisical-client-secret.source = "/run/secrets/${id}-infisical-client-secret";`,
    ])
    .join("\n");
  return `{
  imports = [
    ./deployment-control-plane-container-module.nix
  ];

  services.viberoots.deploymentControlPlaneContainer = {
    enable = true;
    image = "${input.image}";
    instanceId = "${input.instanceId}";
    publicUrl = "${input.publicUrl}";
    workerReplicas = ${Math.max(2, input.workerReplicas)};
    artifactStore.bucket = "${input.artifactBucket}";
    infisicalDeploymentIds = [ ${input.deploymentIds.map((id) => `"${id}"`).join(" ")} ];
    credentials = {
      control-plane-database-url.source = "/run/secrets/control-plane-database-url";
      control-plane-token.source = "/run/secrets/control-plane-token";
      reviewed-source-ssh-key.source = "/run/secrets/reviewed-source-ssh-key";
      reviewed-source-known-hosts.source = "/run/secrets/reviewed-source-known-hosts";
      artifact-store-endpoint.source = "/run/secrets/artifact-store-endpoint";
      artifact-store-access-key-id.source = "/run/secrets/artifact-store-access-key-id";
      artifact-store-secret-access-key.source = "/run/secrets/artifact-store-secret-access-key";
${infisicalCredentials}
    };
  };
}`;
}

function observabilityProfile(
  input: CloudControlSetupInput,
  processes: RenderedControlPlaneProcess[],
) {
  return `${JSON.stringify(
    {
      schemaVersion: "aws-ec2-control-plane-observability@1",
      logSink: {
        kind: "cloudwatch",
        retentionDays: 30,
        accessControlDigest: "sha256:reviewed-log-access",
      },
      unitLogRouting: Object.fromEntries(
        processes.map((process) => [process.name, process.systemdUnit]),
      ),
      history: { readiness: true, workerHeartbeat: true },
      alarms: REQUIRED_AWS_EC2_ALARMS.map((id) => ({
        id,
        target: `${input.instanceId}-${id}`,
        action: "reviewed-notification-hook",
      })),
    },
    null,
    2,
  )}\n`;
}

function evidenceContract(input: CloudControlSetupInput, processes: RenderedControlPlaneProcess[]) {
  return `${JSON.stringify(
    {
      schemaVersion: "aws-ec2-host-profile-evidence-contract@1",
      requiredProcessCount: processes.length,
      requiredWorkerCount: Math.max(2, input.workerReplicas),
      requiredAlarms: [...REQUIRED_AWS_EC2_ALARMS],
      requiredFields: [
        "instanceId",
        "amiId",
        "launchTemplateId",
        "instanceProfileArn",
        "imageDigest",
        "configDigest",
        "credentialManifestDigest",
        "registryPullProof",
        "workerLeaseFencing",
      ],
    },
    null,
    2,
  )}\n`;
}

function unitPath(process: RenderedControlPlaneProcess): string {
  return `systemd/${process.systemdUnit}`;
}

function nixSource(name: string): string {
  return readFileSync(new URL(`../nix/${name}`, import.meta.url), "utf8");
}
