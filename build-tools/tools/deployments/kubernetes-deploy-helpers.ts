import type { KubernetesDeployment } from "./contract.ts";
import type { AdmittedKubernetesComponentArtifact } from "./kubernetes-artifacts.ts";

export function requiredArtifactPaths(
  deployment: KubernetesDeployment,
  artifactDir?: string,
  artifactDirsByComponentId?: Record<string, string>,
): Record<string, string> {
  if (deployment.components.length === 1) {
    const componentId = deployment.components[0]?.id || "default";
    const resolved = artifactDir || artifactDirsByComponentId?.[componentId];
    if (!resolved) throw new Error(`missing artifact path for component "${componentId}"`);
    return { [componentId]: resolved };
  }
  const resolved: Record<string, string> = {};
  for (const component of deployment.components) {
    const artifactPath = artifactDirsByComponentId?.[component.id];
    if (!artifactPath) throw new Error(`missing artifact path for component "${component.id}"`);
    resolved[component.id] = artifactPath;
  }
  return resolved;
}

export function orderedComponentIds(deployment: KubernetesDeployment): string[] {
  return deployment.rolloutPolicy?.steps?.length
    ? [...deployment.rolloutPolicy.steps]
    : deployment.components.map((component) => component.id);
}

export function artifactByComponentId(
  artifacts: AdmittedKubernetesComponentArtifact[],
): Record<string, AdmittedKubernetesComponentArtifact> {
  return Object.fromEntries(artifacts.map((artifact) => [artifact.componentId, artifact]));
}
