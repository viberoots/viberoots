import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import { resolveCredentialSinkSelection } from "./infisical-iac-bootstrap-sink";

export async function buildDryRunReport(args: BootstrapArgs) {
  const sink = await resolveCredentialSinkSelection(args);
  if (args.mode === "repo") {
    return {
      schemaVersion: "infisical-repo-bootstrap-operations@1",
      mode: "repo",
      resolverConfig: {
        directory: "sprinkleref",
        profiles: ["vault-default", "infisical-default"],
        categories: ["main", "bootstrap"],
      },
      credentialSink: sink.kind,
      credentialSinkBackend: sink.backend,
    };
  }
  return {
    schemaVersion: "infisical-iac-bootstrap-operations@1",
    mode: "deployment",
    target: args.target,
    tofu: {
      directory: args.tofuDir,
      savedPlan: args.tofuPlanFile || "<temporary repo-ignored plan path>",
      apply: !args.noTofuApply,
    },
    credentialSink: sink.kind,
    credentialSinkBackend: sink.backend,
  };
}

export async function buildDryRunGuidance(args: BootstrapArgs): Promise<string[]> {
  const sink = await resolveCredentialSinkSelection(args);
  return [`Credential sink: ${sink.description}`];
}
