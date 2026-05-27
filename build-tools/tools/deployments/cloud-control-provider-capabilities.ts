import type { ProviderCapabilityDeclaration } from "./cloud-control-setup-types";

const RUN = "deploy --deployment <label>";

export const CLOUD_CAPABILITY_IDS = [
  "aws-ec2-control-plane-host",
  "aws-attic-cache-service",
  "aws-s3-artifact-store",
  "aws-network-foundation",
  "supabase-managed-postgres",
  "supabase-privatelink-prerequisite",
  "cloudflare-edge",
  "vercel-operator-ui",
  "remote-build-worker-fleet",
] as const;

type CloudCapabilityId = (typeof CLOUD_CAPABILITY_IDS)[number];

export const CONCRETE_PROVIDER_CAPABILITIES: Record<
  CloudCapabilityId,
  ProviderCapabilityDeclaration
> = {
  "aws-ec2-control-plane-host": cap(
    "aws-ec2-control-plane-host",
    "AWS account, region, EC2 launch template, host profile, and service/worker unit set",
    "Infisical-backed AWS role credential files mounted into the control-plane worker",
    "aws:ec2-control-plane-host:{account}:{region}:{host-profile}",
    ["EC2 instance profile identity", "service and worker /readyz", "runtime DB/S3 path proof"],
    ["last reviewed launch template", "previous systemd/Podman unit set"],
    ["ec2-preview-digest", "ec2-apply-digest", "ec2-runtime-smoke", "worker-shutdown-proof"],
  ),
  "aws-attic-cache-service": cap(
    "aws-attic-cache-service",
    "AWS account, region, atticd host profile, S3 cache bucket, and cache endpoint",
    "Infisical-backed AWS cache service role plus Attic token files",
    "aws:attic-cache:{account}:{region}:{cache-profile}",
    ["atticd health", "cache object PUT/GET", "token scope inspection"],
    ["previous atticd image digest", "previous cache endpoint and bucket policy"],
    ["attic-preview-digest", "attic-apply-digest", "attic-smoke", "cache-rollback-proof"],
  ),
  "aws-s3-artifact-store": cap(
    "aws-s3-artifact-store",
    "AWS account, region, artifact bucket, lifecycle policy, KMS key, and VPC endpoint",
    "Infisical-backed AWS S3 artifact-store role credential files",
    "aws:s3-artifact-store:{account}:{region}:{bucket}",
    ["bucket HEAD", "artifact PUT/GET/HEAD", "metadata and digest conformance"],
    ["previous bucket policy", "previous lifecycle policy", "retained immutable objects"],
    ["s3-preview-digest", "s3-apply-digest", "artifact-conformance", "endpoint-proof"],
  ),
  "aws-network-foundation": cap(
    "aws-network-foundation",
    "AWS account, region, VPC, private subnets, security groups, endpoints, ALB/NLB, TLS, and DNS",
    "Infisical-backed AWS network provisioning role credential files",
    "aws:network-foundation:{account}:{region}:{vpc}",
    ["subnet and security-group match", "ALB/NLB health", "TLS/DNS health"],
    ["previous listener rules", "previous security groups", "previous DNS target"],
    ["network-preview-digest", "network-apply-digest", "ingress-smoke", "dns-tls-proof"],
  ),
  "supabase-managed-postgres": cap(
    "supabase-managed-postgres",
    "Supabase organization, project, region, Postgres instance, and connection policy",
    "Supabase access token file for metadata plus mounted Postgres URL file for conformance",
    "supabase:postgres:{organization}:{project}:{region}",
    ["SQL feature conformance", "TLS connectivity from selected host", "migration lock proof"],
    ["last accepted connection policy", "restored database backup reference"],
    ["postgres-preview-digest", "postgres-conformance", "connectivity-smoke", "backup-proof"],
  ),
  "supabase-privatelink-prerequisite": cap(
    "supabase-privatelink-prerequisite",
    "Supabase project, AWS account, region, PrivateLink service name, endpoint, and approval record",
    "Support-mediated evidence plus file-backed Supabase/AWS read credentials",
    "supabase:privatelink:{project}:{aws-account}:{region}:{endpoint}",
    ["endpoint accepted", "private DNS path", "Postgres TLS from EC2"],
    ["disable endpoint route", "return database connectivity to reviewed public TLS path"],
    ["privatelink-request", "privatelink-approval", "endpoint-smoke", "private-db-proof"],
    "gated prerequisite; support-mediated steps are evidence, not hidden mutation authority",
  ),
  "cloudflare-edge": cap(
    "cloudflare-edge",
    "Cloudflare account, zone, DNS records, TLS mode, WAF/rate-limit rules, and callback route",
    "Infisical-backed Cloudflare API token file scoped to the reviewed zone",
    "cloudflare:edge:{account}:{zone}:{hostname}",
    ["DNS proxy status", "full-strict TLS", "WAF/rate-limit posture", "callback route"],
    ["previous DNS target", "previous TLS/WAF rules", "edge bypass disabled"],
    ["cloudflare-preview-digest", "cloudflare-apply-digest", "edge-smoke", "callback-proof"],
  ),
  "vercel-operator-ui": cap(
    "vercel-operator-ui",
    "Vercel team, project, domain, environment, and operator UI/API deployment",
    "Infisical-backed Vercel token file scoped to the reviewed project",
    "vercel:operator-ui:{team}:{project}:{environment}",
    ["project/domain binding", "operator UI read smoke", "auth callback route"],
    ["previous deployment alias", "previous project settings", "domain rollback target"],
    ["vercel-preview-digest", "vercel-apply-digest", "operator-ui-smoke", "alias-proof"],
  ),
  "remote-build-worker-fleet": cap(
    "remote-build-worker-fleet",
    "AWS account, region, remote builder fleet, Buck RE workers, Nix builders, and scaling policy",
    "Infisical-backed AWS fleet role plus separate Buck/Nix worker credential files",
    "aws:remote-build-fleet:{account}:{region}:{fleet}",
    ["worker registration", "autoscaling policy dry run", "separate Buck/Nix authority proof"],
    ["previous fleet capacity", "previous launch template", "drain workers before rollback"],
    ["fleet-preview-digest", "fleet-apply-digest", "worker-smoke", "authority-separation-proof"],
    "eligible only as an adjacent build-system capability, never as a deployment worker scheduler",
  ),
};

export function capabilityDeclaration(id: string): ProviderCapabilityDeclaration {
  const declaration = CONCRETE_PROVIDER_CAPABILITIES[id as CloudCapabilityId];
  if (!declaration) throw new Error(`unknown cloud provider capability ${id}`);
  return structuredClone(declaration);
}

function cap(
  id: CloudCapabilityId,
  targetIdentity: string,
  credentialSource: string,
  lockScope: string,
  smokeChecks: string[],
  rollbackProcedure: string[],
  auditEvidence: string[],
  eligibility = "eligible after reviewed preview, apply, smoke, rollback, and audit evidence",
): ProviderCapabilityDeclaration {
  return {
    id,
    targetIdentity,
    credentialSource,
    lockScope,
    previewDiffBehavior:
      "control-plane preview records a redacted IaC/provider CLI diff digest before apply",
    mutationSequence: [
      "admission revalidation",
      "provider lock acquisition",
      "redacted preview/diff",
      "operator approval",
      "idempotent apply through reviewed provider hook",
      "smoke check",
      "control-plane audit evidence capture",
    ],
    smokeChecks,
    rollbackProcedure,
    replaySemantics:
      "replay uses control-plane audit records, immutable artifact digests, and declared target identity",
    auditEvidence,
    protectedSharedEligibility: eligibility,
    iac: {
      reviewedReference: `iac/cloud-control/${id}/README.md`,
      previewCommand: `${RUN} --preview --provider-capability ${id}`,
      applyCommand: `${RUN} --provider-capability ${id}`,
      smokeCommand: `${RUN} --smoke --provider-capability ${id}`,
      evidenceCommand: `${RUN} --record --provider-capability ${id}`,
    },
  };
}
