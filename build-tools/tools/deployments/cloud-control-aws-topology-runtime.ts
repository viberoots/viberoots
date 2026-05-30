import {
  evidenceList,
  evidenceObject,
  evidenceText,
  freshEvidenceAt,
  type EvidenceFreshnessOptions,
} from "./cloud-control-evidence-helpers";
import type { AwsArtifactBackend } from "./cloud-control-aws-topology-types";

export type AwsTopologyValidationOptions = EvidenceFreshnessOptions & {
  expectedRegion?: string;
  selectedCapabilityIds?: readonly string[];
};

export function awsTopologyArtifactBackend(topology: unknown): AwsArtifactBackend {
  const backend = evidenceText(topology, "artifactBackend");
  return backend === "supabase-storage-s3" || backend === "s3-compatible" ? backend : "aws-s3";
}

export function validateArtifactStore(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const rawBackend = evidenceText(topology, "artifactBackend");
  if (rawBackend && !["aws-s3", "supabase-storage-s3", "s3-compatible"].includes(rawBackend)) {
    return [`unsupported AWS artifact backend ${rawBackend}`];
  }
  const backend = awsTopologyArtifactBackend(topology);
  if (backend !== "aws-s3") {
    return reviewedEvidence(topology, "artifactBackendEvidence", backend, options);
  }
  const endpoint = evidenceObject(topology).s3VpcEndpoint;
  const errors = requireFresh(endpoint, "AWS S3 VPC endpoint", options);
  if (!/^vpce-[a-z0-9]+$/i.test(evidenceText(endpoint, "endpointId"))) {
    errors.push("missing AWS S3 VPC endpoint artifact-store evidence");
  }
  if (!evidenceText(endpoint, "endpointPolicyDigest").startsWith("sha256:")) {
    errors.push("AWS S3 VPC endpoint evidence missing endpoint policy digest");
  }
  if (!evidenceText(endpoint, "bucket")) errors.push("AWS S3 endpoint evidence missing bucket");
  if (!evidenceText(endpoint, "prefix")) errors.push("AWS S3 endpoint evidence missing prefix");
  if (
    evidenceText(endpoint, "type") === "gateway" &&
    evidenceList(endpoint, "routeTableIds").length === 0
  ) {
    errors.push("AWS S3 gateway endpoint evidence missing route-table associations");
  }
  errors.push(...validateS3GatewayRouteTables(topology, endpoint));
  if (
    evidenceText(endpoint, "type") === "interface" &&
    evidenceList(endpoint, "securityGroupIds").length === 0
  ) {
    errors.push("AWS S3 interface endpoint evidence missing security-group associations");
  }
  errors.push(...validateS3InterfaceSecurityGroups(topology, endpoint));
  if (!["gateway", "interface"].includes(evidenceText(endpoint, "type"))) {
    errors.push("AWS S3 VPC endpoint evidence has unsupported endpoint type");
  }
  return errors;
}
function validateS3GatewayRouteTables(topology: unknown, endpoint: unknown): string[] {
  if (evidenceText(endpoint, "type") !== "gateway") return [];
  const object = evidenceObject(topology);
  const subnets = Array.isArray(object.privateSubnets) ? object.privateSubnets : [];
  const subnetRouteTables = subnets
    .map((item) => evidenceText(item, "routeTableId"))
    .filter(Boolean);
  const selectedRouteTables = new Set([
    ...subnetRouteTables,
    ...evidenceList(object.egress, "routeTableIds"),
  ]);
  const endpointRouteTables = evidenceList(endpoint, "routeTableIds");
  return [
    ...endpointRouteTables.flatMap((id) =>
      selectedRouteTables.has(id)
        ? []
        : [`AWS S3 gateway endpoint route table ${id} is not selected in topology`],
    ),
    ...subnetRouteTables.flatMap((id) =>
      endpointRouteTables.includes(id)
        ? []
        : [`AWS S3 gateway endpoint missing selected private subnet route table ${id}`],
    ),
  ];
}

function validateS3InterfaceSecurityGroups(topology: unknown, endpoint: unknown): string[] {
  if (evidenceText(endpoint, "type") !== "interface") return [];
  const selectedId = evidenceText(
    evidenceObject(evidenceObject(topology).securityGroups).s3Endpoint,
    "id",
  );
  const endpointIds = evidenceList(endpoint, "securityGroupIds");
  const errors = endpointIds.flatMap((id) =>
    id === selectedId
      ? []
      : [`AWS S3 interface endpoint security group ${id} is not the selected S3 endpoint group`],
  );
  if (selectedId && !endpointIds.includes(selectedId)) {
    errors.push("AWS S3 interface endpoint evidence missing selected S3 endpoint security group");
  }
  return errors;
}
export function validateComputeAndIngress(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const object = evidenceObject(topology);
  const compute = evidenceObject(object.compute);
  const ingress = evidenceObject(object.ingress);
  const processEvidence = evidenceObject(compute.processEvidence);
  const errors = [
    ...requireFresh(compute, "AWS compute", options),
    ...requireFresh(processEvidence, "AWS process evidence", options),
    ...requireFresh(ingress, "AWS ingress", options),
  ];
  const computeMode = evidenceText(compute, "mode");
  if (!["ec2-instance", "auto-scaling-group"].includes(computeMode)) {
    errors.push("AWS compute evidence has unsupported compute mode");
  }
  if (computeMode === "ec2-instance" && !evidenceText(compute, "instanceId")) {
    errors.push("AWS compute evidence missing EC2 instance identity");
  }
  if (computeMode === "auto-scaling-group" && !evidenceText(compute, "autoScalingGroupName")) {
    errors.push("AWS compute evidence missing Auto Scaling group identity");
  }
  if (!evidenceText(processEvidence, "service")) {
    errors.push("AWS process evidence missing service process proof");
  }
  if (evidenceList(processEvidence, "workers").length === 0) {
    errors.push("AWS process evidence missing worker process proof");
  }
  for (const field of [
    "launchTemplateId",
    "launchTemplateVersion",
    "amiId",
    "instanceProfileArn",
  ]) {
    if (!evidenceText(compute, field)) errors.push(`AWS compute evidence missing ${field}`);
  }
  for (const field of [
    "listenerArn",
    "targetGroupArn",
    "certificateArn",
    "tlsPolicy",
    "dnsRecord",
    "callbackHost",
  ]) {
    if (!evidenceText(ingress, field)) errors.push(`AWS ingress evidence missing ${field}`);
  }
  if (!["alb", "nlb"].includes(evidenceText(ingress, "type"))) {
    errors.push("AWS ingress evidence has unsupported load balancer type");
  }
  if (ingress.targetHealth !== "healthy") errors.push("AWS ingress target health is not healthy");
  return errors;
}

export function validateDatabase(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const database = evidenceObject(evidenceObject(topology).database);
  const mode = evidenceText(database, "mode");
  if (mode === "public") return validatePublicDatabase(database.publicTls, options);
  if (mode === "privatelink") return validatePrivateLinkDatabase(database.privatelink, options);
  return [`unsupported or missing AWS database connectivity mode ${mode || "<missing>"}`];
}

export function validateSupportPrerequisites(
  topology: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const prerequisites = evidenceObject(topology).supportPrerequisites;
  if (!Array.isArray(prerequisites)) return [];
  const selected = new Set(options.selectedCapabilityIds ?? []);
  return prerequisites.flatMap((item, index) => {
    const errors = requireFresh(item, `AWS support prerequisite ${index}`, options);
    const capabilityId = evidenceText(item, "capabilityId");
    if (!capabilityId || !evidenceText(item, "evidenceRef")) {
      errors.push(`AWS support prerequisite ${index} must name capability id and evidence ref`);
    }
    if (capabilityId && !selected.has(capabilityId)) {
      errors.push(`AWS support prerequisite ${index} capability ${capabilityId} is not selected`);
    }
    if (!["requested", "accepted", "complete"].includes(evidenceText(item, "status"))) {
      errors.push(`AWS support prerequisite ${index} has unsupported status`);
    }
    return errors;
  });
}

function reviewedEvidence(
  topology: unknown,
  field: string,
  backend: string,
  options: AwsTopologyValidationOptions,
): string[] {
  const evidence = evidenceObject(topology)[field];
  const errors = requireFresh(evidence, `${backend} reviewed evidence`, options);
  if (!evidenceText(evidence, "reviewedReference") || !evidenceText(evidence, "digest")) {
    errors.push(`${backend}: missing reviewed alternate artifact backend evidence`);
  }
  return errors;
}

function validatePublicDatabase(value: unknown, options: AwsTopologyValidationOptions): string[] {
  const errors = requireFresh(value, "public database connectivity", options);
  const evidence = evidenceObject(value);
  if (
    evidence.tlsValidated !== true ||
    !evidenceText(evidence, "sourceHost") ||
    !evidenceText(evidence, "targetHost")
  ) {
    errors.push("missing public database connectivity validation evidence");
  }
  if (!evidenceText(evidence, "psqlProofDigest").startsWith("sha256:")) {
    errors.push("public database connectivity evidence missing psql proof digest");
  }
  return errors;
}

function validatePrivateLinkDatabase(
  value: unknown,
  options: AwsTopologyValidationOptions,
): string[] {
  const errors = requireFresh(value, "Supabase PrivateLink", options);
  if (!evidenceText(value, "endpointId") && !evidenceText(value, "serviceNetworkAssociationId")) {
    errors.push("missing Supabase PrivateLink endpoint or service-network association evidence");
  }
  for (const field of ["resourceConfigurationArn", "ramShareArn", "psqlProofDigest"])
    if (!evidenceText(value, field)) errors.push(`missing Supabase PrivateLink ${field} evidence`);
  if (!evidenceText(value, "psqlProofDigest").startsWith("sha256:")) {
    errors.push("Supabase PrivateLink evidence missing psql proof digest");
  }
  if (evidenceList(value, "endpointDnsNames").length === 0) {
    errors.push("missing Supabase PrivateLink endpoint DNS evidence");
  }
  if (evidenceList(value, "endpointIps").length === 0) {
    errors.push("missing Supabase PrivateLink endpoint IP evidence");
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
