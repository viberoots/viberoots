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
  | "provider-capability";

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
    "tag",
    "token",
    "worker-id",
    "worker-replicas",
  ]);
  if (isControlPlaneCommand(mode)) return mode;
  throw new Error(
    "usage: deployment-control-plane <service|worker|setup|image-publication|provider-capability|setup-doctor|credential-preflight|credential-staging|credential-rotation|managed-dependencies|cutover-evidence|cutover>",
  );
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
    mode === "provider-capability"
  );
}
