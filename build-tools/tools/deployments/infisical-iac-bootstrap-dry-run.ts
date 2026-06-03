import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import { withDeploymentBootstrapDefaults } from "./infisical-iac-bootstrap-config";
import { buildDeploymentFanOutDryRunReport } from "./infisical-iac-bootstrap-deployments";
import { buildRepoDryRunMaterializationPlan } from "./infisical-iac-bootstrap-dry-run-plan";
import { resolveCredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { DEFAULT_SPRINKLEREF_CONFIG_PATH } from "./sprinkleref-config-select";

export async function buildDryRunReport(args: BootstrapArgs) {
  const sink = await resolveCredentialSinkSelection(args);
  if (args.mode === "repo") {
    const materializationPlan = await buildRepoDryRunMaterializationPlan({ sink });
    return {
      schemaVersion: "infisical-repo-bootstrap-operations@1",
      mode: "repo",
      resolverConfig: {
        directory: DEFAULT_SPRINKLEREF_CONFIG_PATH.replace(/\/selected\.local\.json$/, ""),
        profiles: materializationPlan.profiles.map((profile) => profile.name),
        categories: ["main", "bootstrap"],
      },
      credentialSink: sink.kind,
      credentialSinkBackend: sink.backend,
      materializationPlan,
      deploymentFanOut: await buildDeploymentFanOutDryRunReport(args),
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
