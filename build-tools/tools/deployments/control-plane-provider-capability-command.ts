import { getFlagStr } from "../lib/cli";
import { printDeployJson } from "./deploy-front-door";
import {
  runProviderCapabilityHookForCli,
  selectedProviderCapabilityPhase,
} from "./deploy-cli-provider-capability";

export async function runControlPlaneProviderCapabilityCommand(): Promise<void> {
  const capabilityId = getFlagStr("provider-capability", "").trim();
  const deploymentId = getFlagStr("deployment-id", "").trim();
  if (!capabilityId) throw new Error("provider-capability mode requires --provider-capability");
  if (!deploymentId) throw new Error("provider-capability mode requires --deployment-id");
  printDeployJson(
    await runProviderCapabilityHookForCli({
      capabilityId,
      phase: selectedProviderCapabilityPhase(),
      deploymentLabel: deploymentId,
    }),
  );
}
