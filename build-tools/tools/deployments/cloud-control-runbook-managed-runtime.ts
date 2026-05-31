import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { setupAwsTopology } from "./cloud-control-setup-aws-topology";

export function sourceHostPrelude(): string {
  return [
    "SOURCE_HOST_KIND=unknown",
    "RUNTIME_HOST_PROFILE=unknown",
    'SOURCE_HOST_IDENTITY="$(curl -fsS --connect-timeout 1 http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || true)"',
    'SOURCE_AWS_REGION="$(curl -fsS --connect-timeout 1 http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || true)"',
    'if [ -n "$SOURCE_HOST_IDENTITY" ]; then SOURCE_HOST_KIND=aws-ec2; RUNTIME_HOST_PROFILE=aws-ec2; else SOURCE_HOST_IDENTITY="$(hostname -f 2>/dev/null || hostname)"; fi',
  ].join("; ");
}

export function managedRuntimeFlags(input: CloudControlSetupInput): string {
  const values = managedRuntimeValues(input);
  return [
    '--host-profile "$RUNTIME_HOST_PROFILE"',
    '--aws-region "$SOURCE_AWS_REGION"',
    flag("supabase-project-ref", values.supabaseProjectRef),
    flag("supabase-region", values.supabaseRegion),
    flag("privatelink-endpoint-id", values.privatelinkEndpointId),
    flag("privatelink-resource-id", values.privatelinkResourceId),
    flag("s3-vpc-endpoint-id", values.s3VpcEndpointId),
    flag("s3-endpoint-policy-digest", values.s3EndpointPolicyDigest),
    flag("artifact-iam-role-arn", values.artifactIamRoleArn),
    flag("artifact-least-privilege-policy-digest", values.artifactLeastPrivilegePolicyDigest),
    flag("alternate-backend-evidence-ref", values.alternateBackendEvidenceRef),
    flag("alternate-backend-evidence-digest", values.alternateBackendEvidenceDigest),
  ]
    .filter(Boolean)
    .join(" ");
}

function managedRuntimeValues(input: CloudControlSetupInput) {
  const topology = setupAwsTopology(input);
  const database = topology?.database;
  const privatelink = database?.mode === "privatelink" ? database.privatelink : undefined;
  return {
    privatelinkEndpointId: privatelink?.endpointId,
    privatelinkResourceId: privatelink?.resourceConfigurationArn,
    supabaseProjectRef: privatelink?.supabaseProjectRef,
    supabaseRegion: privatelink?.supabaseRegion,
    s3VpcEndpointId: topology?.s3VpcEndpoint?.endpointId,
    s3EndpointPolicyDigest: topology?.s3VpcEndpoint?.endpointPolicyDigest,
    artifactIamRoleArn: input.artifactIamRoleArn,
    artifactLeastPrivilegePolicyDigest: input.artifactLeastPrivilegePolicyDigest,
    alternateBackendEvidenceRef: topology?.artifactBackendEvidence?.reviewedReference,
    alternateBackendEvidenceDigest: topology?.artifactBackendEvidence?.digest,
  };
}

function flag(name: string, value: string | undefined): string | undefined {
  return value ? `--${name} ${shellQuote(value)}` : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
