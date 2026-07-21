import type { NixBuilderPolicy } from "../lib/nix-builder-policy";
import type { RemoteBuilderSystem } from "../remote-exec/nix-remote-builder-config";
import { assertRemoteBuilderSmokeEvidence } from "../remote-exec/nix-remote-builder-config";
import { isActiveRemoteBuilderSmokeEvidence } from "../remote-exec/nix-remote-builder-smoke";

export function remoteBuilderSmokeAdmissionError(opts: {
  policy: NixBuilderPolicy;
  expectedSystem: RemoteBuilderSystem;
  activeEvidence?: unknown;
  testOnlyEvidence?: unknown;
}): string | undefined {
  try {
    if (!opts.activeEvidence && !opts.testOnlyEvidence) {
      throw new Error("remote builder smoke must run in the active admission invocation");
    }
    const evidence = opts.activeEvidence || opts.testOnlyEvidence;
    assertRemoteBuilderSmokeEvidence(evidence, {
      policy: opts.policy,
      expectedSystem: opts.expectedSystem,
    });
    if (
      !opts.testOnlyEvidence &&
      !isActiveRemoteBuilderSmokeEvidence(
        evidence,
        opts.policy as "inherit_config" | "force_builders_file",
      )
    ) {
      throw new Error("remote builder smoke must run in the active admission invocation");
    }
    return undefined;
  } catch (error) {
    return `remote:ready requires admitted remote-builder smoke results: ${error instanceof Error ? error.message : String(error)}`;
  }
}
