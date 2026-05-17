import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";

export function buildDryRunReport(args: BootstrapArgs) {
  return {
    schemaVersion: "infisical-iac-bootstrap-operations@1",
    deterministic: true,
    browserAutomation: false,
    tofu: {
      directory: args.tofuDir,
      savedPlan: args.tofuPlanFile || "<temporary repo-ignored plan path>",
      apply: !args.noTofuApply,
    },
    credentialSink: args.credentialSink === "auto" ? "local-file" : args.credentialSink,
    applicationSecretsManaged: false,
  };
}
