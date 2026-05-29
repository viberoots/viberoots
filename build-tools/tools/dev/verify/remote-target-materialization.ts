import type { RemoteExecTargetMetadata } from "../remote-exec-policy-check";

export function referencedNixStorePaths(commandText: string): string[] {
  return Array.from(new Set(commandText.match(/\/nix\/store\/[A-Za-z0-9._+?-]+/g) || []));
}

export function parseMaterializationContractMetadata(
  labels: readonly string[],
  providerText: string,
  commandText: string,
): Partial<RemoteExecTargetMetadata> {
  const declared =
    labels.includes("materialization-manifest:declared") ||
    providerText.includes("materialization-manifest:declared");
  const manifestPaths = Array.from(
    new Set(
      [...providerText.matchAll(/materialization-manifest:path=([^"',\s\]\)]+)/g)].map(
        (match) => match[1],
      ),
    ),
  );
  const paths = referencedNixStorePaths(commandText);
  return {
    ...(declared ? { materializationManifestDeclared: true } : {}),
    ...(manifestPaths.length > 0 ? { materializationManifestPaths: manifestPaths } : {}),
    ...(paths.length > 0 ? { referencedNixStorePaths: paths } : {}),
  };
}
