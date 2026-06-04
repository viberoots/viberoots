import { getPositionalsWithValueFlags } from "../lib/cli";

export type ControlPlaneCommand =
  | "service"
  | "worker"
  | "setup"
  | "cutover"
  | "cutover-evidence"
  | "setup-doctor"
  | "credential-preflight"
  | "credential-staging"
  | "credential-rotation"
  | "image-publication"
  | "managed-dependencies"
  | "provider-capability"
  | "aws-account";

export const CONTROL_PLANE_USAGE =
  "usage: control-plane <service|worker|setup|image-publication|provider-capability|setup-doctor|credential-preflight|credential-staging|credential-rotation|managed-dependencies|cutover-evidence|cutover|aws-account>";

export function selectedControlPlaneCommand(): ControlPlaneCommand {
  const [mode] = getPositionalsWithValueFlags([
    "artifact-backend",
    "artifact-backend-evidence",
    "artifact-bucket",
    "artifact-credential-mode",
    "artifact-iam-role-arn",
    "artifact-least-privilege-policy-digest",
    "artifact-region",
    "aws-topology-evidence",
    "aws-attic-cache-evidence",
    "auth-callback-host",
    "auth-callback-path",
    "config",
    "bundle-dir",
    "credential-directory",
    "credential-owner-gid",
    "credential-owner-uid",
    "stale-credential",
    "deployment-id",
    "host-mode",
    "host-mount-evidence",
    "image",
    "instance-id",
    "live-backend-profile",
    "live-host-verification-evidence",
    "live-host-verifier-profile",
    "live-host-verifier-trust-profile",
    "out",
    "poll-ms",
    "profile",
    "provider-capability",
    "provider-capability-phase",
    "process-mode",
    "public-url",
    "evidence",
    "expected-host-profile",
    "expected-region",
    "ecr-opentofu-plan",
    "ecr-opentofu-apply",
    "ecr-readonly-evidence",
    "ec2-host-mode",
    "ec2-asg-opentofu-plan",
    "ec2-asg-opentofu-apply",
    "ec2-asg-readonly-evidence",
    "cloudflare-edge-evidence",
    "max-age-minutes",
    "operation",
    "image-build-identity",
    "image-publication-evidence",
    "image-tarball",
    "ingress-command-evidence",
    "published-digest",
    "registry-profile",
    "reviewed-source-mode",
    "rotated-map-out",
    "runtime-input",
    "secret-backend-evidence",
    "selected-capability",
    "service-replicas",
    "skopeo",
    "source-revision",
    "supabase-postgres-profile",
    "supabase-privatelink-opentofu-plan",
    "supabase-privatelink-opentofu-apply",
    "supabase-privatelink-readonly-evidence",
    "remote-build-worker-fleet-evidence",
    "tag",
    "token",
    "worker-id",
    "worker-replicas",
    "vercel-operator-ui-evidence",
    "auth-host",
    "auth-service",
    "aws-account-id",
    "aws-organization-id",
    "backend-state-key",
    "domain",
    "environment",
    "evidence-dir",
    "expected-aws-account-id",
    "expected-aws-role-arn",
    "private-db-host",
    "private-db-service",
    "service",
    "service-host",
    "stack",
    "state-bucket-name",
    "state-lock-table-name",
    "supabase-access-token-env",
    "supabase-api-base-url",
    "supabase-org-id",
    "supabase-project-ref",
    "supabase-region",
  ]);
  if (isControlPlaneCommand(mode)) return mode;
  throw new Error(CONTROL_PLANE_USAGE);
}

function isControlPlaneCommand(mode: string): mode is ControlPlaneCommand {
  return (
    mode === "service" ||
    mode === "worker" ||
    mode === "setup" ||
    mode === "cutover" ||
    mode === "cutover-evidence" ||
    mode === "setup-doctor" ||
    mode === "credential-preflight" ||
    mode === "credential-staging" ||
    mode === "credential-rotation" ||
    mode === "image-publication" ||
    mode === "managed-dependencies" ||
    mode === "provider-capability" ||
    mode === "aws-account"
  );
}
