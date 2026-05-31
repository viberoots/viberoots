import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import type { ArtifactCredentialMode } from "./control-plane-artifact-credential-mode";

export function setupAwsTopology(input: CloudControlSetupInput) {
  return input.mode === "aws-ec2" ? input.awsTopology : undefined;
}

export function setupUsesSupabasePrivateLink(input: CloudControlSetupInput): boolean {
  return setupAwsTopology(input)?.database.mode === "privatelink";
}

export function setupAwsSubnetIds(input: CloudControlSetupInput): string[] {
  return (setupAwsTopology(input)?.privateSubnets || []).map((subnet) => subnet.id);
}

export function setupAwsSecurityGroupIds(input: CloudControlSetupInput): string[] {
  const groups = setupAwsTopology(input)?.securityGroups;
  if (!groups) return [];
  return [
    groups.service.id,
    groups.worker.id,
    groups.loadBalancer.id,
    groups.s3Endpoint.id,
    groups.privatelink?.id || "",
  ].filter(Boolean);
}

export function setupAwsTlsEvidenceRef(input: CloudControlSetupInput): string {
  const ingress = setupAwsTopology(input)?.ingress;
  if (!ingress) return "";
  return [ingress.listenerArn, ingress.targetGroupArn, ingress.certificateArn, ingress.dnsRecord]
    .filter(Boolean)
    .join(" ");
}

export function setupArtifactBackendEvidenceRef(input: CloudControlSetupInput): string {
  const evidence = setupAwsTopology(input)?.artifactBackendEvidence;
  return evidence ? `${evidence.reviewedReference} ${evidence.digest}`.trim() : "";
}

export function setupArtifactCredentialMode(input: CloudControlSetupInput): ArtifactCredentialMode {
  return input.artifactCredentialMode || "files";
}
