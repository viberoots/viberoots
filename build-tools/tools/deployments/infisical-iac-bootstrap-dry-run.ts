import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import { withDeploymentBootstrapDefaults } from "./infisical-iac-bootstrap-config";
import { buildRepoDryRunMaterializationPlan } from "./infisical-iac-bootstrap-dry-run-plan";
import { resolveCredentialSinkSelection } from "./infisical-iac-bootstrap-sink";

export async function buildDryRunReport(args: BootstrapArgs) {
  const sink = await resolveCredentialSinkSelection(args);
  if (args.mode === "repo") {
    const materializationPlan = await buildRepoDryRunMaterializationPlan({ sink });
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
      materializationPlan,
    };
  }
  const deploymentArgs = withDeploymentBootstrapDefaults(args);
  return {
    schemaVersion: "infisical-iac-bootstrap-operations@1",
    mode: "deployment",
    target: deploymentArgs.target,
    tofu: {
      directory: deploymentArgs.tofuDir,
      savedPlan: deploymentArgs.tofuPlanFile || "<temporary repo-ignored plan path>",
      apply: !deploymentArgs.noTofuApply,
    },
    credentialSink: sink.kind,
    credentialSinkBackend: sink.backend,
  };
}

export async function buildDryRunGuidance(args: BootstrapArgs): Promise<string[]> {
  const sink = await resolveCredentialSinkSelection(args);
  return [`Credential sink: ${sink.description}`];
}
