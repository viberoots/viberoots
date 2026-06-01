import * as crypto from "node:crypto";
import { evidenceList, evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";
import { validateAwsTopologyEvidence } from "./cloud-control-aws-topology-validate";
import {
  AWS_EC2_HOST_HOOK_PAYLOAD_SCHEMA,
  validateAwsEc2HostProviderPayload,
} from "./cloud-control-aws-ec2-host-hook-validation";
import type {
  CloudProviderCapabilityHookPhase,
  HookAdapter,
  HookAdapterPhaseOptions,
  HookAdapterResult,
} from "./cloud-control-provider-capability-hooks";

export function awsEc2HostHookAdapter(): HookAdapter {
  const phase = (selectedPhase: CloudProviderCapabilityHookPhase) => {
    return async (opts: HookAdapterPhaseOptions) => ec2HostHookResult(selectedPhase, opts);
  };
  return {
    name: "repo-owned-aws-ec2-host-structured-adapter",
    automated: true,
    preview: phase("preview"),
    apply: phase("apply"),
    evidence: phase("evidence"),
    smoke: phase("smoke"),
    rollback: phase("rollback"),
  };
}

function ec2HostHookResult(
  phase: CloudProviderCapabilityHookPhase,
  opts: HookAdapterPhaseOptions,
): HookAdapterResult {
  const topology = opts.awsTopologyEvidence;
  if (!topology) throw new Error("aws-ec2-control-plane-host: requires AWS topology evidence");
  const errors = validateAwsTopologyEvidence(topology, { maxAgeMinutes: 60 });
  if (errors.length > 0) {
    throw new Error(`aws-ec2-control-plane-host: AWS topology rejected: ${errors.join("; ")}`);
  }
  const payload = ec2HostPayload(phase, opts);
  const payloadErrors = validateAwsEc2HostProviderPayload(
    "aws-ec2-control-plane-host",
    { phase, providerPayload: payload },
    { expectedAwsTopology: topology },
  );
  if (payloadErrors.length > 0) {
    throw new Error(payloadErrors.join("; "));
  }
  return {
    summary: `aws-ec2-control-plane-host ${phase}`,
    rawOutput: JSON.stringify(payload),
    payload,
  };
}

function ec2HostPayload(phase: CloudProviderCapabilityHookPhase, opts: HookAdapterPhaseOptions) {
  const topology = evidenceObject(opts.awsTopologyEvidence);
  const compute = evidenceObject(topology.compute);
  const userData = evidenceObject(compute.userData);
  const profile = evidenceObject(opts.awsEc2Profile);
  const identity = {
    accountId: evidenceText(topology, "accountId"),
    region: evidenceText(topology, "region"),
    computeMode: evidenceText(compute, "mode"),
    instanceId: evidenceText(compute, "instanceId"),
    autoScalingGroupName: evidenceText(compute, "autoScalingGroupName"),
    launchTemplateId: evidenceText(compute, "launchTemplateId"),
    launchTemplateVersion: evidenceText(compute, "launchTemplateVersion"),
    amiId: evidenceText(compute, "amiId"),
    amiPinPath: evidenceText(compute.amiSelection, "pinPath"),
    instanceType: evidenceText(compute, "instanceType"),
    instanceProfileArn: evidenceText(compute, "instanceProfileArn"),
    privateSubnetIds: placementSubnets(compute),
    securityGroupIds: evidenceList(compute, "securityGroupIds"),
    bootstrapDigest: evidenceText(userData, "digest"),
    containerRuntime: "podman-systemd",
    credentialMountMode: evidenceText(profile.credentialMountWiring, "mode"),
  };
  return {
    schemaVersion: AWS_EC2_HOST_HOOK_PAYLOAD_SCHEMA,
    capabilityId: "aws-ec2-control-plane-host",
    phase,
    deploymentLabel: opts.deploymentLabel,
    provisioningBoundary: "non-mutating-structured-ec2-host-adapter",
    hostProfile: "aws-ec2",
    mutationAuthority: false,
    identity,
    generatedProfile: {
      schemaVersion: evidenceText(profile, "schemaVersion"),
      preferredHost: evidenceText(profile, "preferredHost"),
      compatibilityHost: evidenceText(profile, "compatibilityHost"),
      compute: profile.compute,
      network: profile.network,
      credentialMountMode: evidenceText(profile.credentialMountWiring, "mode"),
      systemdUnits: evidenceList(profile, "systemdUnits"),
    },
    operation: operation(phase, identity),
    smokeEvidence: phase === "smoke",
    rollback: {
      nonDestructive: true,
      proofRefs: ["worker-shutdown-proof", "previous systemd/Podman unit set"],
    },
  };
}

function placementSubnets(compute: Record<string, unknown>): string[] {
  const launchTemplate = evidenceList(compute, "launchTemplateSubnetIds");
  return launchTemplate.length > 0
    ? launchTemplate
    : evidenceList(compute, "autoScalingGroupSubnetIds");
}

function operation(phase: CloudProviderCapabilityHookPhase, identity: Record<string, unknown>) {
  const action =
    phase === "preview"
      ? "validate-preview"
      : phase === "apply"
        ? "validate-apply-intent"
        : phase === "rollback"
          ? "validate-rollback"
          : phase === "smoke"
            ? "validate-smoke"
            : "collect-evidence";
  return {
    tool: "aws-ec2-host-structured-adapter",
    action,
    executed: false,
    mutationAuthority: false,
    commandTemplates: commandTemplates(phase),
    outputDigest: digest(JSON.stringify({ phase, identity })),
  };
}

function commandTemplates(phase: CloudProviderCapabilityHookPhase): string[][] {
  if (phase === "smoke") return [["aws", "ec2", "describe-instance-status"]];
  if (phase === "rollback") return [["aws", "ec2", "describe-launch-template-versions"]];
  return [
    ["aws", "ec2", "describe-instances"],
    ["aws", "ec2", "describe-launch-template-versions"],
  ];
}

function digest(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
