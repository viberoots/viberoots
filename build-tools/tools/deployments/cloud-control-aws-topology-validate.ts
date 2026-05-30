import {
  evidenceList,
  evidenceObject,
  evidenceSecretErrors,
  evidenceSourceErrors,
  evidenceText,
  freshEvidenceAt,
  isEvidenceObject,
} from "./cloud-control-evidence-helpers";
import {
  awsTopologyArtifactBackend,
  validateArtifactStore,
  validateComputeAndIngress,
  validateDatabase,
  validateSupportPrerequisites,
  type AwsTopologyValidationOptions,
} from "./cloud-control-aws-topology-runtime";
import {
  AWS_TOPOLOGY_EVIDENCE_SCHEMA,
  type AwsDatabaseConnectivityMode,
} from "./cloud-control-aws-topology-types";
import { validateFoundation } from "./cloud-control-aws-topology-foundation";
import {
  awsTopologyDatabaseMode,
  awsTopologyRequiredCapabilityIds,
  awsTopologySelectedCapabilityIds,
} from "./cloud-control-aws-topology-capabilities";
import {
  validateAwsHostProfileRuntime,
  type AwsHostProfileValidationOptions,
} from "./cloud-control-aws-host-profile-runtime";

export { awsTopologyArtifactBackend, type AwsTopologyValidationOptions };
export {
  awsTopologyDatabaseMode,
  awsTopologyRequiredCapabilityIds,
  awsTopologySelectedCapabilityIds,
};

export function validateAwsTopologyEvidence(
  topology: unknown,
  options: AwsHostProfileValidationOptions,
): string[] {
  if (topology === true) return ["AWS topology evidence must be typed, not literal true"];
  if (!isEvidenceObject(topology)) return ["AWS topology evidence is missing or empty"];
  const topologyOptions = {
    ...options,
    selectedCapabilityIds: [
      ...new Set([
        ...(options.selectedCapabilityIds ?? []),
        ...awsTopologyRequiredCapabilityIds(topology),
      ]),
    ],
  };
  return [
    ...validateCore(topology, topologyOptions),
    ...validateNetwork(topology, topologyOptions),
    ...validateFoundation(topology, topologyOptions),
    ...validateAwsHostProfileRuntime(topology, topologyOptions),
    ...validateArtifactStore(topology, topologyOptions),
    ...validateComputeAndIngress(topology, topologyOptions),
    ...validateDatabase(topology, topologyOptions),
    ...validateSelectedEdges(topology, topologyOptions),
    ...validateSupportPrerequisites(topology, topologyOptions),
    ...evidenceSourceErrors(topology, "awsTopology"),
    ...evidenceSecretErrors(topology, "awsTopology"),
  ];
}

function validateSelectedEdges(topology: unknown, options: AwsTopologyValidationOptions): string[] {
  const edges = evidenceObject(evidenceObject(topology).selectedEdges);
  return [
    ...requireEdgeFields(
      edges.cloudflare,
      "Cloudflare",
      ["dnsProxy", "tlsMode", "wafRules", "callbackRoute"],
      options,
    ),
    ...requireEdgeFields(
      edges.vercel,
      "Vercel",
      ["project", "domain", "edgeSettings", "callbackRoute"],
      options,
    ),
  ];
}

function requireEdgeFields(
  value: unknown,
  label: string,
  fields: string[],
  options: AwsTopologyValidationOptions,
): string[] {
  if (!value) return [];
  const edge = evidenceObject(value);
  const errors = requireFresh(edge, `${label} edge`, options);
  for (const name of fields) {
    const field = edge[name];
    if (!isEvidenceObject(field)) {
      errors.push(`${label} edge ${name} evidence must be structured reviewed evidence`);
      continue;
    }
    errors.push(...requireFresh(field, `${label} edge ${name}`, options));
    if (!evidenceText(field, "reviewedReference") || !evidenceText(field, "digest")) {
      errors.push(`${label} edge ${name} evidence missing reviewed reference or digest`);
    }
  }
  return errors;
}

function validateCore(topology: unknown, options: AwsTopologyValidationOptions): string[] {
  const errors: string[] = [];
  if (evidenceText(topology, "schemaVersion") !== AWS_TOPOLOGY_EVIDENCE_SCHEMA) {
    errors.push("AWS topology evidence has unsupported schemaVersion");
  }
  if (!freshEvidenceAt(topology, options)) errors.push("AWS topology evidence is missing or stale");
  const accountId = evidenceText(topology, "accountId");
  const region = evidenceText(topology, "region");
  if (!/^\d{12}$/.test(accountId)) errors.push("AWS topology account id is missing or invalid");
  if (!region) errors.push("AWS topology region is missing");
  if (region && options.expectedRegion && region !== options.expectedRegion) {
    errors.push(`AWS topology region ${region} does not match expected region`);
  }
  return errors;
}

function validateNetwork(topology: unknown, options: AwsTopologyValidationOptions): string[] {
  const object = evidenceObject(topology);
  const vpc = evidenceObject(object.vpc);
  const subnets = Array.isArray(object.privateSubnets) ? object.privateSubnets : [];
  const routeTables = new Set(subnets.map((item) => evidenceText(item, "routeTableId")));
  const errors = [
    ...requireFresh(vpc, "AWS topology VPC", options),
    ...requireFresh(object.egress, "AWS topology egress", options),
  ];
  if (!/^vpc-[a-z0-9]+$/i.test(evidenceText(vpc, "id"))) errors.push("missing AWS VPC id");
  if (vpc.dnsSupport !== true) errors.push("AWS VPC evidence must prove DNS support");
  if (subnets.length === 0) errors.push("missing AWS private subnet evidence");
  for (const [index, subnet] of subnets.entries())
    errors.push(...validateSubnet(subnet, index, evidenceText(vpc, "id"), options));
  const egressTables = new Set(evidenceList(object.egress, "routeTableIds"));
  if (!["nat-gateway", "controlled-egress"].includes(evidenceText(object.egress, "mode"))) {
    errors.push("AWS egress evidence must declare NAT gateway or controlled egress posture");
  }
  if (
    evidenceText(object.egress, "mode") === "nat-gateway" &&
    evidenceList(object.egress, "natGatewayIds").length === 0
  ) {
    errors.push("AWS egress NAT gateway evidence missing NAT gateway identity");
  }
  for (const routeTableId of routeTables)
    if (routeTableId && !egressTables.has(routeTableId)) {
      errors.push(`AWS egress evidence missing route table ${routeTableId}`);
    }
  errors.push(
    ...validateSecurityGroups(
      object.securityGroups,
      evidenceText(vpc, "id"),
      awsTopologyDatabaseMode(topology),
      options,
    ),
  );
  return errors;
}

function validateSubnet(
  subnet: unknown,
  index: number,
  vpcId: string,
  options: AwsTopologyValidationOptions,
): string[] {
  const errors = requireFresh(subnet, `AWS private subnet ${index}`, options);
  if (!/^subnet-[a-z0-9]+$/i.test(evidenceText(subnet, "id"))) {
    errors.push(`AWS private subnet ${index} is missing an id`);
  }
  if (evidenceText(subnet, "vpcId") !== vpcId) {
    errors.push("AWS topology subnet evidence does not match selected VPC");
  }
  if (!evidenceText(subnet, "availabilityZone")) {
    errors.push(`AWS private subnet ${index} is missing availability zone`);
  }
  if (!/^rtb-[a-z0-9]+$/i.test(evidenceText(subnet, "routeTableId"))) {
    errors.push(`AWS private subnet ${index} is missing route table`);
  }
  return errors;
}

function validateSecurityGroups(
  value: unknown,
  vpcId: string,
  databaseMode: AwsDatabaseConnectivityMode | undefined,
  options: AwsTopologyValidationOptions,
): string[] {
  const groups = evidenceObject(value);
  const required = ["service", "worker", "loadBalancer", "s3Endpoint"];
  const errors = required.flatMap((name) =>
    validateSecurityGroup(groups[name], `AWS ${name} security group`, vpcId, options),
  );
  if (databaseMode !== "privatelink") return errors;
  if (!groups.privatelink)
    return [...errors, "missing Supabase PrivateLink security-group evidence"];
  return [
    ...errors,
    ...validateSecurityGroup(
      groups.privatelink,
      "Supabase PrivateLink security group",
      vpcId,
      options,
    ),
  ];
}

function validateSecurityGroup(
  group: unknown,
  label: string,
  vpcId: string,
  options: AwsTopologyValidationOptions,
): string[] {
  const errors = requireFresh(group, label, options);
  if (!/^sg-[a-z0-9]+$/i.test(evidenceText(group, "id"))) errors.push(`${label} missing id`);
  if (evidenceText(group, "vpcId") !== vpcId) {
    errors.push("AWS topology security-group evidence does not match selected VPC");
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
