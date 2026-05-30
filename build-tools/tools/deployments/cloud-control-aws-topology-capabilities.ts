import { evidenceObject, evidenceText } from "./cloud-control-evidence-helpers";
import { awsTopologyArtifactBackend } from "./cloud-control-aws-artifact-backend";
import type { AwsDatabaseConnectivityMode } from "./cloud-control-aws-topology-types";

export function awsTopologyDatabaseMode(
  topology: unknown,
): AwsDatabaseConnectivityMode | undefined {
  const mode = evidenceText(evidenceObject(topology).database, "mode");
  return mode === "public" || mode === "privatelink" ? mode : undefined;
}

export function awsTopologySelectedCapabilityIds(topology: unknown): string[] {
  const object = evidenceObject(topology);
  const selectedEdges = evidenceObject(object.selectedEdges);
  const adjacent = evidenceObject(object.adjacentSystems);
  return [
    selectedEdges.cloudflare ? "cloudflare-edge" : "",
    selectedEdges.vercel ? "vercel-operator-ui" : "",
    adjacent.atticd ? "aws-attic-cache-service" : "",
    adjacent.remoteBuildWorkerFleet ? "remote-build-worker-fleet" : "",
  ].filter(Boolean);
}

export function awsTopologyRequiredCapabilityIds(topology: unknown): string[] {
  const backend = awsTopologyArtifactBackend(topology);
  const databaseMode = awsTopologyDatabaseMode(topology);
  return unique([
    "aws-ec2-control-plane-host",
    "aws-network-foundation",
    "aws-ecr-control-plane-registry",
    backend === "aws-s3" ? "aws-s3-artifact-store" : "",
    databaseMode ? "supabase-managed-postgres" : "",
    databaseMode === "privatelink" ? "supabase-privatelink-prerequisite" : "",
    ...awsTopologySelectedCapabilityIds(topology),
  ]);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
