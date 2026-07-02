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
  GITHUB_APP_FILENAMES,
  SSH_REVIEWED_SOURCE_FILENAMES,
} from "./cloud-control-setup-contract";
import {
  setupArtifactBackendEvidenceRef,
  setupArtifactCredentialMode,
  setupAwsSecurityGroupIds,
  setupAwsSubnetIds,
  setupUsesSupabasePrivateLink,
} from "./cloud-control-setup-aws-topology";
import { podmanRun, systemdUnit, userDataScript } from "./cloud-control-aws-ec2-systemd";
import { awsEc2ArtifactIamBindingField } from "./cloud-control-aws-ec2-artifact-iam-binding";
import { DEFAULT_EC2_HOST_MODE } from "./cloud-control-aws-ec2-host-mode";
import { ec2BootstrapDigestForMode } from "./cloud-control-aws-ec2-asg-bootstrap";
import { REQUIRED_AWS_EC2_ALARMS } from "./cloud-control-aws-ec2-alarms";

export { REQUIRED_AWS_EC2_ALARMS } from "./cloud-control-aws-ec2-alarms";

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
    ec2HostMode: input.ec2HostMode || DEFAULT_EC2_HOST_MODE,
    preferredHost: "nixos-ec2",
    compatibilityHost: "systemd-podman",
    artifactBackend: {
      selected: input.artifactBackend,
      credentialMode: setupArtifactCredentialMode(input),
      defaultPath: "AWS S3 through a VPC endpoint",
      iamRoleArn: input.artifactIamRoleArn,
      leastPrivilegePolicyDigest: input.artifactLeastPrivilegePolicyDigest,
      ...awsEc2ArtifactIamBindingField(input),
      reviewedAlternateEvidence: alternate,
    },
    network: {
      subnetIds: setupAwsSubnetIds(input),
      securityGroupIds: setupAwsSecurityGroupIds(input),
      supabasePrivatelink: setupUsesSupabasePrivateLink(input),
      serviceIngress: serviceIngress(input, processes),
    },
    compute: computeProfile(input),
    systemdUnits: processes.map((process) => process.systemdUnit),
    podmanRunScript: "aws-ec2-podman-run.sh",
    nixosModuleExample: "nixos/aws-ec2-control-plane-host.example.nix",
    processes,
    imagePublication: input.imagePublication,
    registryProfile: input.imagePublication?.registryProfile,
    mounts: controlPlaneMountSpecs("host-path"),
    credentialMountWiring: {
      mode: "bind-mounted-credential-directory",
      target: "/run/deployment-control-plane/credentials",
      readOnly: true,
    },
    runtimeUser: { uid: CONTROL_PLANE_UID, gid: CONTROL_PLANE_GID },
    observabilityProfile: "aws-ec2-observability-profile.json",
    hostProfileEvidenceContract: "aws-ec2-host-profile-evidence.contract.json",
    protectedSharedReady: false,
  });
}

function serviceIngress(input: CloudControlSetupInput, processes: RenderedControlPlaneProcess[]) {
  const service = processes.find((process) => process.role === "service");
  const ingress = (input.awsTopology as any)?.ingress || {};
  const access = ingress.accessControl || {};
  return {
    process: service?.name,
    systemdUnit: service?.systemdUnit,
    bindHost: service?.serviceBindHost,
    bindPort: service?.servicePort,
    containerPort: 7780,
    sourceSecurityGroupIds: access.sourceSecurityGroupIds || [],
    serviceSecurityGroupId: access.serviceSecurityGroupId,
    loadBalancerSecurityGroupId: access.loadBalancerSecurityGroupId,
    targetGroupArn: ingress.targetGroupArn,
  };
}

function computeProfile(input: CloudControlSetupInput) {
  const compute = (input.awsTopology as any)?.compute || {};
  return {
    amiId: compute.amiId,
    amiBuildIdentity: compute.amiBuildIdentity,
    amiPinPath: compute.amiSelection?.pinPath,
    instanceId: compute.instanceId,
    autoScalingGroupName: compute.autoScalingGroupName,
    launchTemplateId: compute.launchTemplateId,
    launchTemplateVersion: compute.launchTemplateVersion,
    selectedSubnetIds: compute.launchTemplateSubnetIds || compute.autoScalingGroupSubnetIds || [],
    securityGroupIds: compute.securityGroupIds || [],
    instanceType: compute.instanceType,
    instanceProfileArn: compute.instanceProfileArn,
    bootstrapDigest: ec2BootstrapDigestForMode(input.ec2HostMode, compute.userData?.digest),
    containerRuntime: "podman-systemd",
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
  const artifactCredentials =
    setupArtifactCredentialMode(input) === "files"
      ? `
      artifact-store-access-key-id.source = "/run/secrets/artifact-store-access-key-id";
      artifact-store-secret-access-key.source = "/run/secrets/artifact-store-secret-access-key";`
      : "";
  const reviewedSourceCredentials = reviewedSourceCredentialSources(input);
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
    reviewedSourceMode = "${input.reviewedSourceMode}";
    artifactStore.bucket = "${input.artifactBucket}";
    artifactStore.provider = "${input.artifactBackend}";
    artifactStore.credentialMode = "${setupArtifactCredentialMode(input)}";
    infisicalDeploymentIds = [ ${input.deploymentIds.map((id) => `"${id}"`).join(" ")} ];
    credentials = {
      control-plane-database-url.source = "/run/secrets/control-plane-database-url";
      control-plane-token.source = "/run/secrets/control-plane-token";
${reviewedSourceCredentials}
      artifact-store-endpoint.source = "/run/secrets/artifact-store-endpoint";
${artifactCredentials}
${infisicalCredentials}
    };
  };
}`;
}

function reviewedSourceCredentialSources(input: CloudControlSetupInput): string {
  const filenames =
    input.reviewedSourceMode === "github-app"
      ? GITHUB_APP_FILENAMES
      : SSH_REVIEWED_SOURCE_FILENAMES;
  return filenames.map((name) => `      ${name}.source = "/run/secrets/${name}";`).join("\n");
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
