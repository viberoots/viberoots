import {
  evidenceList,
  evidenceObject,
  evidenceSecretErrors,
  evidenceSourceErrors,
  evidenceText,
  freshEvidenceAt,
  isEvidenceObject,
} from "./cloud-control-evidence-helpers";
import { validateSelectedEdges } from "./cloud-control-aws-edge-validate";
import {
  validateArtifactStore,
  validateDatabase,
  validateSupportPrerequisites,
  type AwsTopologyValidationOptions,
} from "./cloud-control-aws-topology-runtime";
import { AWS_TOPOLOGY_EVIDENCE_SCHEMA } from "./cloud-control-aws-topology-types";
import { awsTopologyRequiredCapabilityIds } from "./cloud-control-aws-topology-capabilities";

export function validateAwsTopologyPreApplyEvidence(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  if (topology === true) return ["AWS topology evidence must be typed, not literal true"];
  if (!isEvidenceObject(topology)) return ["AWS topology evidence is missing or empty"];
  const opts = {
    ...options,
    selectedCapabilityIds: [
      ...new Set([
        ...(options.selectedCapabilityIds ?? []),
        ...awsTopologyRequiredCapabilityIds(topology),
      ]),
    ],
  };
  return [
    ...validateCore(topology, opts),
    ...validateNetwork(topology, opts),
    ...validateFoundationPresence(topology),
    ...validateDesiredAsgCompute(topology, opts),
    ...validateArtifactStore(topology, opts),
    ...validateDatabase(topology, opts),
    ...validateSelectedEdges(topology, opts),
    ...validateSupportPrerequisites(topology, opts),
    ...evidenceSourceErrors(topology, "awsTopology"),
    ...evidenceSecretErrors(topology, "awsTopology"),
  ];
}

function validateFoundationPresence(topology: unknown): string[] {
  return evidenceObject(topology).foundation
    ? []
    : ["AWS topology missing repo-owned foundation profile"];
}

function validateCore(topology: unknown, options: AwsTopologyValidationOptions): string[] {
  const errors: string[] = [];
  if (evidenceText(topology, "schemaVersion") !== AWS_TOPOLOGY_EVIDENCE_SCHEMA) {
    errors.push("AWS topology evidence has unsupported schemaVersion");
  }
  if (!freshEvidenceAt(topology, options)) errors.push("AWS topology evidence is missing or stale");
  if (!/^\d{12}$/.test(evidenceText(topology, "accountId"))) {
    errors.push("AWS topology account id is missing or invalid");
  }
  const region = evidenceText(topology, "region");
  if (!region) errors.push("AWS topology region is missing");
  if (region && options.expectedRegion && region !== options.expectedRegion) {
    errors.push(`AWS topology region ${region} does not match expected region`);
  }
  return errors;
}

function validateNetwork(topology: unknown, options: AwsTopologyValidationOptions): string[] {
  const object = evidenceObject(topology);
  const vpc = evidenceObject(object.vpc);
  const errors = requireFresh(vpc, "AWS topology VPC", options);
  if (!/^vpc-[a-z0-9]+$/i.test(evidenceText(vpc, "id"))) errors.push("missing AWS VPC id");
  if (vpc.dnsSupport !== true) errors.push("AWS VPC evidence must prove DNS support");
  if (!Array.isArray(object.privateSubnets) || object.privateSubnets.length === 0) {
    errors.push("missing AWS private subnet evidence");
  }
  return errors;
}

function validateDesiredAsgCompute(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const compute = evidenceObject(evidenceObject(topology).compute);
  const amiSelection = evidenceObject(compute.amiSelection);
  const errors = requireFresh(compute, "AWS desired ASG compute inputs", options);
  if (evidenceText(compute, "mode") !== "auto-scaling-group") {
    errors.push("AWS desired ASG compute inputs must use auto-scaling-group mode");
  }
  for (const field of ["autoScalingGroupName", "amiId", "instanceType", "instanceProfileArn"]) {
    if (!evidenceText(compute, field)) errors.push(`AWS desired ASG inputs missing ${field}`);
  }
  if (evidenceText(amiSelection, "amiId") !== evidenceText(compute, "amiId")) {
    errors.push("AWS desired ASG AMI selection does not pin the selected AMI id");
  }
  if (!evidenceText(amiSelection, "pinPath").startsWith("sha256:")) {
    errors.push("AWS desired ASG AMI selection missing pinned AMI path");
  }
  if (evidenceList(compute, "launchTemplateSubnetIds").length === 0) {
    errors.push("AWS desired ASG inputs missing private subnet placement");
  }
  if (evidenceList(compute, "securityGroupIds").length === 0) {
    errors.push("AWS desired ASG inputs missing service/worker security groups");
  }
  return errors;
}

function requireFresh(
  value: unknown,
  label: string,
  options: AwsTopologyValidationOptions,
): string[] {
  return freshEvidenceAt(value, options) ? [] : [`${label} evidence is missing or stale`];
}
