import {
  evidenceList,
  evidenceObject,
  evidenceText,
  freshEvidenceAt,
} from "./cloud-control-evidence-helpers";
import { REQUIRED_AWS_EC2_ALARMS } from "./cloud-control-aws-ec2-host-profile";
import type { AwsTopologyValidationOptions } from "./cloud-control-aws-topology-runtime";

export type AwsHostProfileValidationOptions = AwsTopologyValidationOptions & {
  expectedImage?: string;
  expectedImageDigest?: string;
};

export function validateAwsHostProfileRuntime(
  topology: unknown,
  options: AwsHostProfileValidationOptions,
): string[] {
  const object = evidenceObject(topology);
  const compute = evidenceObject(object.compute);
  return [
    ...validateAmi(compute, options),
    ...validatePlacement(object, compute),
    ...validateHostPosture(compute),
    ...validateProcessEvidence(compute.processEvidence, compute.registryPullProof),
    ...validateRegistryPull(compute.registryPullProof, options),
    ...validateObservability(object.operationalVisibility, options),
  ];
}

function validateAmi(
  compute: Record<string, unknown>,
  options: AwsHostProfileValidationOptions,
): string[] {
  const selection = evidenceObject(compute.amiSelection);
  const buildIdentity = evidenceText(compute, "amiBuildIdentity");
  const errors: string[] = [];
  if (!buildIdentity) errors.push("AWS compute evidence missing AMI build identity");
  if (selection.source !== "reviewed-nixos-build-import") {
    errors.push("AWS compute AMI selection must come from reviewed NixOS build/import");
  }
  if (evidenceText(selection, "amiId") !== evidenceText(compute, "amiId")) {
    errors.push("AWS compute AMI selection does not pin the selected AMI id");
  }
  if (evidenceText(selection, "buildIdentity") !== buildIdentity) {
    errors.push("AWS compute AMI selection does not match AMI build identity");
  }
  if (!evidenceText(selection, "pinPath").startsWith("sha256:")) {
    errors.push("AWS compute AMI selection missing pinned AMI path");
  }
  if (/marketplace|latest|alias/i.test(evidenceText(selection, "pinPath"))) {
    errors.push("AWS compute AMI selection must not use mutable marketplace or alias-like pins");
  }
  if (selection.ownerReviewed !== true) errors.push("AWS compute AMI owner is not reviewed");
  return errors;
}

function validatePlacement(topology: Record<string, unknown>, compute: Record<string, unknown>) {
  const privateSubnets = Array.isArray(topology.privateSubnets) ? topology.privateSubnets : [];
  const subnetIds = new Set(privateSubnets.map((item) => evidenceText(item, "id")).filter(Boolean));
  const foundationIds = new Set(
    evidenceList(evidenceObject(evidenceObject(topology.foundation).network), "privateSubnetIds"),
  );
  const selected = placementSubnets(compute);
  const errors: string[] = [];
  if (selected.length === 0) {
    errors.push("AWS compute launch template or ASG missing selected private subnet placement");
  }
  for (const id of selected) {
    if (!subnetIds.has(id) || !foundationIds.has(id)) {
      errors.push(`AWS compute subnet ${id} is not selected in reviewed foundation topology`);
    }
  }
  const selectedGroups = new Set(evidenceList(compute, "securityGroupIds"));
  const groups = evidenceObject(topology.securityGroups);
  for (const name of ["service", "worker"]) {
    const id = evidenceText(groups[name], "id");
    if (id && !selectedGroups.has(id)) {
      errors.push(`AWS compute security groups missing selected ${name} group`);
    }
  }
  return errors;
}

function validateHostPosture(compute: Record<string, unknown>): string[] {
  const ebs = evidenceObject(compute.ebs);
  const access = evidenceObject(compute.access);
  const userData = evidenceObject(compute.userData);
  const recovery = evidenceObject(compute.recovery);
  const cadence = evidenceObject(compute.patchCadence);
  const errors: string[] = [];
  if (ebs.encrypted !== true || !evidenceText(ebs, "statePath")) {
    errors.push("AWS compute EBS evidence missing encryption or state path");
  }
  if (!["automatic-replacement", "manual-reviewed"].includes(evidenceText(recovery, "mode"))) {
    errors.push("AWS compute recovery profile is missing");
  }
  const fencing = evidenceObject(recovery.workerLeaseFencing);
  if (
    fencing.duplicateActiveWorkersPrevented !== true ||
    !evidenceText(fencing, "evidenceDigest")
  ) {
    errors.push("AWS compute recovery missing durable worker lease/fencing evidence");
  }
  if (!["ssm-session-manager", "reviewed-ssh-break-glass"].includes(evidenceText(access, "mode"))) {
    errors.push("AWS compute access posture missing SSM or reviewed SSH evidence");
  }
  if (access.mode === "ssm-session-manager" && !evidenceText(access, "evidenceDigest")) {
    errors.push("AWS compute SSM access evidence is missing");
  }
  if (access.broadInboundSsh === true) errors.push("AWS compute SSH access is too broad");
  if (userData.activatesGeneratedArtifacts !== true || userData.providerMutation === true) {
    errors.push("AWS compute user data must only activate generated artifacts");
  }
  if (!evidenceText(cadence, "hostImage") || !evidenceText(cadence, "containerImage")) {
    errors.push("AWS compute missing host image and container image patch cadence");
  }
  return errors;
}

function validateProcessEvidence(value: unknown, registryPullProof: unknown): string[] {
  const evidence = evidenceObject(value);
  const registry = evidenceObject(registryPullProof);
  const errors: string[] = [];
  if (evidenceList(evidence, "workers").length < 2) {
    errors.push("AWS process evidence requires at least two worker process proofs");
  }
  for (const field of ["imageDigest", "configDigest", "credentialManifestDigest"]) {
    if (!evidenceText(evidence, field).startsWith("sha256:")) {
      errors.push(`AWS process evidence missing ${field}`);
    }
  }
  if (
    evidenceText(registry, "digest") &&
    evidenceText(evidence, "imageDigest") !== evidenceText(registry, "digest")
  ) {
    errors.push("AWS process evidence image digest does not match selected digest");
  }
  for (const field of ["serviceReadiness", "workerHeartbeat", "gracefulShutdown"]) {
    if (evidence[field] !== true) errors.push(`AWS process evidence missing ${field}`);
  }
  return errors;
}

function validateRegistryPull(value: unknown, options: AwsHostProfileValidationOptions): string[] {
  const proof = evidenceObject(value);
  const errors = freshEvidenceAt(proof, options)
    ? []
    : ["AWS registry runtime pull proof is stale"];
  if (proof.hostProfile !== "aws-ec2") errors.push("AWS registry runtime pull proof host mismatch");
  if (options.expectedImage && proof.image !== options.expectedImage) {
    errors.push("AWS registry runtime pull proof image does not match selected image");
  }
  if (options.expectedImageDigest && proof.digest !== options.expectedImageDigest) {
    errors.push("AWS registry runtime pull proof digest does not match selected digest");
  }
  if (!evidenceText(proof, "principal"))
    errors.push("AWS registry runtime pull proof missing principal");
  return errors;
}

function validateObservability(value: unknown, options: AwsTopologyValidationOptions): string[] {
  const visibility = evidenceObject(value);
  const logSink = evidenceObject(visibility.logSink);
  const history = evidenceObject(visibility.history);
  const errors = freshEvidenceAt(visibility, options)
    ? []
    : ["AWS operational visibility evidence is missing or stale"];
  if (!["cloudwatch", "reviewed-alternate"].includes(evidenceText(logSink, "kind"))) {
    errors.push("AWS operational visibility missing reviewed log sink");
  }
  if (Number(logSink.retentionDays) <= 0 || !evidenceText(logSink, "accessControlDigest")) {
    errors.push("AWS operational logs missing retention or access-control evidence");
  }
  if (Object.keys(evidenceObject(visibility.unitLogRouting)).length === 0) {
    errors.push("AWS operational visibility missing unit log routing");
  }
  if (history.readiness !== true || history.workerHeartbeat !== true) {
    errors.push("AWS operational visibility missing readiness or worker-heartbeat history");
  }
  const alarms = new Set(
    (Array.isArray(visibility.alarms) ? visibility.alarms : []).map((alarm) =>
      evidenceText(alarm, "id"),
    ),
  );
  for (const id of REQUIRED_AWS_EC2_ALARMS) {
    if (!alarms.has(id)) errors.push(`AWS operational visibility missing alarm ${id}`);
  }
  return errors;
}

function placementSubnets(compute: Record<string, unknown>): string[] {
  const launchTemplate = evidenceList(compute, "launchTemplateSubnetIds");
  const asg = evidenceList(compute, "autoScalingGroupSubnetIds");
  return launchTemplate.length > 0 ? launchTemplate : asg;
}
