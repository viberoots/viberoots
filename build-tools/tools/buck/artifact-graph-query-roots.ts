import { deploymentGraphQueryRoots } from "../deployments/deployment-query-helpers";
import { getImporterRootsContract } from "../lib/importer-roots";

export function artifactGraphQueryRoots(): string[] {
  return Array.from(
    new Set([
      ...getImporterRootsContract().workspaceRoots,
      ...deploymentGraphQueryRoots(),
      "go",
      "cpp",
      "third_party",
    ]),
  );
}
