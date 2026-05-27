import type { CutoverEvidence, CutoverValidationOptions } from "./cloud-control-cutover-types";

export function validateAwsCutoverTopology(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  if (options.expectedHostProfile !== "aws-ec2") return [];
  const topology = evidence.awsTopology || {};
  return [
    ...validateCoreAws(topology, options),
    ...validateAwsArtifactStore(topology),
    ...validateAwsDatabase(topology),
    ...validateSelectedEdge(topology),
    ...validateAdjacentPrerequisites(evidence, topology),
  ];
}

export function requiredAwsProviderCapabilities(
  evidence: CutoverEvidence,
  options: CutoverValidationOptions,
): string[] {
  if (options.expectedHostProfile !== "aws-ec2") return [];
  const topology = evidence.awsTopology || {};
  const backend = String(topology.artifactBackend || "aws-s3");
  return unique([
    "aws-ec2-control-plane-host",
    "aws-network-foundation",
    backend === "aws-s3" ? "aws-s3-artifact-store" : "",
    topology.databaseConnectivity === "privatelink" || topology.databaseConnectivity === "public"
      ? "supabase-managed-postgres"
      : "",
    topology.databaseConnectivity === "privatelink" ? "supabase-privatelink-prerequisite" : "",
    topology.cloudflareEdgeSelected ? "cloudflare-edge" : "",
    topology.vercelEdgeSelected ? "vercel-operator-ui" : "",
    topology.atticdSelected ? "aws-attic-cache-service" : "",
    topology.remoteBuildWorkerFleetSelected ? "remote-build-worker-fleet" : "",
  ]);
}

function validateCoreAws(
  topology: Record<string, unknown>,
  options: CutoverValidationOptions,
): string[] {
  const errors: string[] = [];
  if (topology.region && options.expectedRegion && topology.region !== options.expectedRegion) {
    errors.push(`AWS topology region ${topology.region} does not match expected region`);
  }
  for (const name of ["subnets", "securityGroups"]) {
    if (!topology[name]) errors.push(`missing AWS topology ${name} evidence`);
  }
  for (const name of ["albNlbHealth", "tlsHealth", "dnsHealth"]) {
    if (!freshEvidence(topology[name], options.maxAgeMinutes)) {
      errors.push(`missing or stale AWS topology ${name} evidence`);
    }
  }
  if (topology.vpcId && topology.subnetVpcId && topology.vpcId !== topology.subnetVpcId) {
    errors.push("AWS topology subnet evidence does not match selected VPC");
  }
  if (
    topology.vpcId &&
    topology.securityGroupVpcId &&
    topology.vpcId !== topology.securityGroupVpcId
  ) {
    errors.push("AWS topology security-group evidence does not match selected VPC");
  }
  return errors;
}

function validateAwsArtifactStore(topology: Record<string, unknown>): string[] {
  const backend = String(topology.artifactBackend || "aws-s3");
  if (backend === "aws-s3") {
    return endpointEvidence(topology.s3VpcEndpoint)
      ? []
      : ["missing AWS S3 VPC endpoint artifact-store evidence"];
  }
  if (!["supabase-storage-s3", "s3-compatible"].includes(backend)) {
    return [`unsupported AWS artifact backend ${backend}`];
  }
  return reviewedEvidence(topology.artifactBackendEvidence)
    ? []
    : [`${backend}: missing reviewed alternate artifact backend evidence`];
}

function validateAwsDatabase(topology: Record<string, unknown>): string[] {
  const mode = topology.databaseConnectivity;
  if (mode !== "privatelink" && mode !== "public") {
    return [`unsupported or missing AWS database connectivity mode ${String(mode || "<missing>")}`];
  }
  if (mode === "privatelink") {
    return endpointEvidence(topology.supabasePrivatelink)
      ? []
      : ["missing Supabase PrivateLink validation evidence"];
  }
  return publicDatabaseEvidence(topology.publicDatabaseConnectivity)
    ? []
    : ["missing public database connectivity validation evidence"];
}

function validateSelectedEdge(topology: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (topology.cloudflareEdgeSelected) {
    const edge = section(topology.cloudflareEdge);
    for (const name of ["dnsProxy", "tlsMode", "wafRules", "callbackRoute"]) {
      if (!edge[name]) errors.push(`missing Cloudflare edge ${name} evidence`);
    }
  }
  if (topology.vercelEdgeSelected) {
    const edge = section(topology.vercelEdge);
    for (const name of ["project", "domain", "edgeSettings", "callbackRoute"]) {
      if (!edge[name]) errors.push(`missing Vercel edge ${name} evidence`);
    }
  }
  return errors;
}

function validateAdjacentPrerequisites(
  evidence: CutoverEvidence,
  topology: Record<string, unknown>,
): string[] {
  const required = [
    ...(topology.atticdSelected ? ["aws-attic-cache-service"] : []),
    ...(topology.remoteBuildWorkerFleetSelected ? ["remote-build-worker-fleet"] : []),
  ];
  const capabilities = evidence.providerCapabilities || {};
  return required.flatMap((id) => {
    const capability = capabilities[id] || {};
    return capability.auditIdentity && capability.smokeEvidence && capability.rollbackProcedure
      ? []
      : [`${id}: missing adjacent-system provider-capability prerequisite evidence`];
  });
}

function freshEvidence(value: unknown, maxAgeMinutes: number): boolean {
  if (value === true) return true;
  const checkedAt = section(value).checkedAt;
  if (typeof checkedAt !== "string") return false;
  const ageMs = Date.now() - Date.parse(checkedAt);
  return Number.isFinite(ageMs) && ageMs <= maxAgeMinutes * 60_000;
}

function endpointEvidence(value: unknown): boolean {
  if (value === true) return true;
  const evidence = section(value);
  return evidence.validated === true && Boolean(evidence.endpointId || evidence.connectionId);
}

function reviewedEvidence(value: unknown): boolean {
  const evidence = section(value);
  return evidence.validated === true && Boolean(evidence.reviewedReference || evidence.digest);
}

function publicDatabaseEvidence(value: unknown): boolean {
  const evidence = section(value);
  return evidence.validated === true && evidence.tls === true && Boolean(evidence.sourceHost);
}

function section(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
