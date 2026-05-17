import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import { resolveCredentialSinkSelection } from "./infisical-iac-bootstrap-sink";

export async function buildDryRunReport(args: BootstrapArgs) {
  const sink = await resolveCredentialSinkSelection(args);
  return {
    schemaVersion: "infisical-iac-bootstrap-operations@1",
    deterministic: true,
    browserAutomation: false,
    tofu: {
      directory: args.tofuDir,
      savedPlan: args.tofuPlanFile || "<temporary repo-ignored plan path>",
      apply: !args.noTofuApply,
    },
    credentialSink: sink.kind,
    credentialSinkBackend: sink.backend,
    credentialSinkDescription: sink.description,
    applicationSecretsManaged: false,
  };
}
