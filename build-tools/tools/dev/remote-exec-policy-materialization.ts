import type { RemoteExecTargetMetadata } from "./remote-exec-policy-check";

export function materializationMessages(target: RemoteExecTargetMetadata): string[] {
  const referenced = target.referencedNixStorePaths || [];
  if (referenced.length === 0) return [];
  if (!target.materializationManifestDeclared) {
    return [
      `remote-ready Nix store paths require a materialization manifest: ${referenced.join(", ")}`,
    ];
  }
  const manifestPaths = new Set(target.materializationManifestPaths || []);
  const missing = referenced.filter((path) => !manifestPaths.has(path));
  return missing.length
    ? [`remote-ready Nix store paths missing from materialization manifest: ${missing.join(", ")}`]
    : [];
}
