import type { RemoteExecTargetMetadata } from "../remote-exec-policy-check";

export function localArtifactPathWrites(commandText: string): string[] {
  const paths = [
    [/\bbuck-out\b/, "buck-out"],
    [/(^|[\s"'=:/])\/tmp(?=$|[\s"',/)])/, "/tmp"],
    [/\bcoverage(?=$|[\/\s"',)])/, "coverage"],
    [/\bNODE_V8_COVERAGE\b/, "NODE_V8_COVERAGE"],
  ] as const;
  return paths.filter(([pattern]) => pattern.test(commandText)).map(([, name]) => name);
}

export function parseArtifactContractMetadata(
  labels: readonly string[],
  providerText: string,
): Partial<RemoteExecTargetMetadata> {
  const declared =
    labels.includes("artifact-contract:declared") ||
    providerText.includes("artifact-contract:declared");
  return declared ? { declaredArtifactContract: true } : {};
}
