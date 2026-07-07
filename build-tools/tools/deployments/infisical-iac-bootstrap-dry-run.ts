import * as path from "node:path";
import { findRepoRoot } from "../lib/repo";
import { defaultDeploymentGraphPath } from "./deployment-graph-read-options";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import {
  withBootstrapCredentialScope,
  withDeploymentBootstrapDefaults,
} from "./infisical-iac-bootstrap-config";
import { buildDeploymentFanOutDryRunReport } from "./infisical-iac-bootstrap-deployments";
import { buildRepoDryRunMaterializationPlan } from "./infisical-iac-bootstrap-dry-run-plan";
import { resolveCredentialSinkSelection } from "./infisical-iac-bootstrap-sink";
import { repoBootstrapCredentialRefs } from "./infisical-iac-bootstrap-identity";
import { DEFAULT_SPRINKLEREF_CONFIG_PATH } from "./sprinkleref-config-select";

export async function buildDryRunReport(
  args: BootstrapArgs,
  context: { workspaceRoot?: string; configPath?: string } = {},
) {
  if (args.mode === "repo") {
    const workspaceRoot = context.workspaceRoot || (await findRepoRoot(process.cwd()));
    const scopedArgs = await withBootstrapCredentialScope(args, workspaceRoot);
    const graphPath = defaultDeploymentGraphPath(workspaceRoot);
    const configPath =
      context.configPath || path.join(workspaceRoot, DEFAULT_SPRINKLEREF_CONFIG_PATH);
    const sink = await resolveCredentialSinkSelection(scopedArgs, { workspaceRoot, configPath });
    const materializationPlan = await buildRepoDryRunMaterializationPlan({
      sink,
      workspaceRoot,
      graphPath,
      configPath,
    });
    return {
      schemaVersion: "infisical-repo-bootstrap-operations@1",
      mode: "repo",
      resolverConfig: {
        directory: DEFAULT_SPRINKLEREF_CONFIG_PATH.replace(/\/shared\.json$/, ""),
        profiles: materializationPlan.profiles.map((profile) => profile.name),
        categories: ["main", "bootstrap"],
      },
      credentialSink: sink.kind,
      credentialSinkBackend: sink.backend,
      bootstrapCredentialRefs: repoBootstrapCredentialRefs(
        { name: scopedArgs.identityName },
        scopedArgs.bootstrapCredentialScope,
      ),
      materializationPlan,
      deploymentFanOut: await buildDeploymentFanOutDryRunReport(scopedArgs, {
        workspaceRoot,
        graphPath,
      }),
    };
  }
  const deploymentArgs = withDeploymentBootstrapDefaults(args);
  const workspaceRoot = context.workspaceRoot || (await findRepoRoot(process.cwd()));
  const scopedArgs = await withBootstrapCredentialScope(deploymentArgs, workspaceRoot);
  const configPath =
    context.configPath || path.join(workspaceRoot, DEFAULT_SPRINKLEREF_CONFIG_PATH);
  const sink = await resolveCredentialSinkSelection(scopedArgs, { workspaceRoot, configPath });
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
    bootstrapCredentialRefs: repoBootstrapCredentialRefs(
      { name: scopedArgs.identityName },
      scopedArgs.bootstrapCredentialScope,
    ),
  };
}

export async function buildDryRunGuidance(
  args: BootstrapArgs,
  context: { workspaceRoot?: string; configPath?: string } = {},
): Promise<string[]> {
  const workspaceRoot = context.workspaceRoot || (await findRepoRoot(process.cwd()));
  const scopedArgs = await withBootstrapCredentialScope(args, workspaceRoot);
  const configPath =
    context.configPath || path.join(workspaceRoot, DEFAULT_SPRINKLEREF_CONFIG_PATH);
  const sink = await resolveCredentialSinkSelection(scopedArgs, { workspaceRoot, configPath });
  return [`Credential sink: ${sink.description}`];
}
