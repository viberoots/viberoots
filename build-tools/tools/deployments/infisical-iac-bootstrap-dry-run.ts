import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import { resolveCredentialSinkSelection } from "./infisical-iac-bootstrap-sink";

export async function buildDryRunReport(args: BootstrapArgs) {
  const sink = await resolveCredentialSinkSelection(args);
  if (args.mode === "repo") {
    return {
      schemaVersion: "infisical-repo-bootstrap-operations@1",
      mode: "repo",
      deterministic: true,
      browserAutomation: false,
      resolverConfig: {
        directory: "sprinkleref",
        profiles: ["vault-default", "infisical-default"],
        categories: ["main", "bootstrap"],
      },
      nextCommands: [
        "sprinkleref --check --config sprinkleref/selected.local.json",
        "sprinkleref --check --category bootstrap --config sprinkleref/selected.local.json",
      ],
      credentialSink: sink.kind,
      credentialSinkBackend: sink.backend,
      credentialSinkDescription: sink.description,
      applicationSecretsManaged: false,
      deploymentProvisioning: false,
    };
  }
  return {
    schemaVersion: "infisical-iac-bootstrap-operations@1",
    mode: "deployment",
    target: args.target,
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
