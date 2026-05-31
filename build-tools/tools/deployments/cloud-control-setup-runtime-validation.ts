import type { CloudControlSetupInput } from "./cloud-control-setup-types";
import { setupArtifactCredentialMode } from "./cloud-control-setup-aws-topology";
import { validateRuntimeInput } from "./cloud-control-runtime-input";

export function validateSetupRuntimeInput(input: CloudControlSetupInput): string[] {
  const runtimeInput = input.runtimeInput;
  return validateRuntimeInput(runtimeInput, {
    expectedCallbackHost: input.authCallbackHost,
    expectedCallbackPath: input.authCallbackPath,
    deploymentIds: input.deploymentIds,
    production: !input.dryRun,
    supabaseProjectRef: input.supabasePostgres?.provisioning.projectRef,
    supabaseConnectionMode: input.supabasePostgres?.connection.mode,
    awsAccountId: input.awsTopology?.accountId,
    awsRegion: input.awsTopology?.region,
    awsVpcId: input.awsTopology?.vpc?.id,
    artifactCredentialMode: setupArtifactCredentialMode(input),
  });
}
