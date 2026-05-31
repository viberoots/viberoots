import { evidenceList, evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";
import { awsTopologyArtifactBackend } from "./cloud-control-aws-artifact-backend";
import { ingressEvidenceFromFoundationOutput } from "./cloud-control-aws-ingress-foundation-output";
import { validateIngressEvidence } from "./cloud-control-aws-ingress-validate";
import { validateAwsFoundationProfile } from "./cloud-control-aws-foundation-profile";
import { awsTopologyDatabaseMode } from "./cloud-control-aws-topology-capabilities";
import type { AwsTopologyValidationOptions } from "./cloud-control-aws-topology-runtime";

export function validateFoundation(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const object = evidenceObject(topology);
  const backend = awsTopologyArtifactBackend(topology);
  if (!object.foundation) {
    return ["AWS topology missing repo-owned foundation profile"];
  }
  return [
    ...validateAwsFoundationProfile(object.foundation, {
      ...options,
      expectedRegion: evidenceText(topology, "region"),
      expectedAccountId: evidenceText(topology, "accountId"),
      expectedArtifactBackend: backend,
      requiresVpcLattice: awsTopologyDatabaseMode(topology) === "privatelink",
    }),
    ...validateFoundationTopologyBinding(topology, object.foundation),
    ...validateFoundationIngress(topology, object.foundation, options),
  ];
}

function validateFoundationTopologyBinding(topology: unknown, foundation: unknown): string[] {
  const errors: string[] = [];
  const foundationNetwork = evidenceObject(evidenceObject(foundation).network);
  const foundationVpcId = evidenceText(foundationNetwork.vpc, "vpcId");
  const topologyVpcId = evidenceText(evidenceObject(topology).vpc, "id");
  if (foundationVpcId !== topologyVpcId) {
    errors.push("AWS foundation VPC id does not match selected topology VPC");
  }
  const foundationSubnets = new Set(evidenceList(foundationNetwork, "privateSubnetIds"));
  for (const subnet of topologySubnets(topology)) {
    const subnetId = evidenceText(subnet, "id");
    if (subnetId && !foundationSubnets.has(subnetId)) {
      errors.push(`AWS foundation missing selected private subnet ${subnetId}`);
    }
    if (evidenceText(subnet, "vpcId") !== foundationVpcId) {
      errors.push("AWS topology subnet VPC does not match foundation VPC");
    }
    if (subnet.mapPublicIpOnLaunch === true) {
      errors.push("AWS selected private subnet is public");
    }
  }
  const routeTables = new Set(evidenceList(foundationNetwork, "routeTableIds"));
  const foundationS3Endpoint = evidenceObject(foundationNetwork.s3VpcEndpoint);
  const topologyS3Endpoint = evidenceObject(evidenceObject(topology).s3VpcEndpoint);
  if (
    evidenceText(foundationS3Endpoint, "endpointId") &&
    evidenceText(topologyS3Endpoint, "endpointId") &&
    evidenceText(foundationS3Endpoint, "endpointId") !==
      evidenceText(topologyS3Endpoint, "endpointId")
  ) {
    errors.push("AWS foundation S3 endpoint id does not match selected topology endpoint");
  }
  for (const routeTableId of s3EndpointRouteTables(topology)) {
    if (!routeTables.has(routeTableId)) {
      errors.push(`AWS foundation missing S3 endpoint route table ${routeTableId}`);
    }
  }
  return errors;
}

function validateFoundationIngress(
  topology: unknown,
  foundation: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const topologyObject = evidenceObject(topology);
  const ingress = evidenceObject(evidenceObject(evidenceObject(foundation).network).ingress);
  const selected = evidenceObject(topologyObject.ingress);
  const drift = evidenceObject(ingress.drift);
  const errors: string[] = [];
  if (!ingress.loadBalancerArn) return ["AWS foundation missing repo-owned ingress evidence"];
  if (!ingress.targetAttachmentId || !ingress.targetInstanceId) {
    errors.push("AWS foundation ingress missing selected target attachment evidence");
  }
  const mapped = ingressEvidenceFromFoundationOutput(ingress);
  if (!mapped) {
    errors.push("AWS foundation ingress cannot map OpenTofu output into topology evidence");
  } else {
    errors.push(
      ...validateIngressEvidence({ ...topologyObject, ingress: mapped }, options).map(
        (error) => `AWS foundation mapped ingress invalid: ${error}`,
      ),
    );
  }
  for (const field of ["loadBalancerArn", "listenerArn", "targetGroupArn", "certificateArn"]) {
    const expected =
      field === "loadBalancerArn"
        ? evidenceText(selected.loadBalancer, "arn")
        : evidenceText(selected, field);
    if (expected && evidenceText(ingress, field) !== expected) {
      errors.push(`AWS foundation ingress ${field} does not match selected topology`);
    }
  }
  if (
    mapped?.targetRegistration?.instanceId &&
    mapped.targetRegistration.instanceId !== evidenceText(selected.targetRegistration, "instanceId")
  ) {
    errors.push(
      "AWS foundation mapped ingress target registration does not match selected topology",
    );
  }
  if (ingress.stateBackend !== "s3" || ingress.stateLock !== "dynamodb") {
    errors.push("AWS foundation ingress must use repo-owned locked state");
  }
  if (
    !drift.checkedAt ||
    drift.status !== "in-sync" ||
    !evidenceText(drift, "diffDigest").startsWith("sha256:")
  ) {
    errors.push("AWS foundation ingress drift evidence is missing, stale, or dirty");
  }
  if (evidenceObject(ingress.rollback).nonDestructive !== true) {
    errors.push("AWS foundation ingress rollback must be non-destructive by default");
  }
  return errors;
}

function topologySubnets(topology: unknown): Record<string, unknown>[] {
  const subnets = evidenceObject(topology).privateSubnets;
  return Array.isArray(subnets) ? subnets.map(evidenceObject) : [];
}

function s3EndpointRouteTables(topology: unknown): string[] {
  return evidenceList(evidenceObject(topology).s3VpcEndpoint, "routeTableIds");
}
