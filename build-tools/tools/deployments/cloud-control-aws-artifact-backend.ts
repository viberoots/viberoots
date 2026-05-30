import { evidenceText } from "./cloud-control-evidence-helpers";
import type { AwsArtifactBackend } from "./cloud-control-aws-topology-types";

export const AWS_ARTIFACT_BACKENDS = [
  "aws-s3",
  "supabase-storage-s3",
  "cloudflare-r2",
  "s3-compatible",
] as const;

export function awsTopologyArtifactBackend(topology: unknown): AwsArtifactBackend {
  const backend = evidenceText(topology, "artifactBackend");
  return backend === "supabase-storage-s3" ||
    backend === "cloudflare-r2" ||
    backend === "s3-compatible"
    ? backend
    : "aws-s3";
}
