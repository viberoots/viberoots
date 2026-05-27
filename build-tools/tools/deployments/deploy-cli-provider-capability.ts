import { getFlagBool, getFlagStr } from "../lib/cli";
import type { DeploymentTarget } from "./contract";
import { printDeployJson } from "./deploy-front-door";
import {
  assertSupportedPhase,
  runCloudProviderCapabilityHook,
  type CloudProviderCapabilityHookPhase,
} from "./cloud-control-provider-capability-hooks";

export async function maybeRunProviderCapabilityHookForCli(opts: {
  deployment: DeploymentTarget;
}): Promise<boolean> {
  const capabilityId = getFlagStr("provider-capability", "").trim();
  if (!capabilityId) return false;
  const phase = selectedProviderCapabilityPhase();
  const evidence = await runCloudProviderCapabilityHook({
    capabilityId,
    phase,
    deploymentLabel: opts.deployment.label,
  });
  printDeployJson(evidence);
  return true;
}

function selectedProviderCapabilityPhase(): CloudProviderCapabilityHookPhase {
  const selected = [
    getFlagBool("preview") ? "preview" : "",
    getFlagBool("smoke") ? "smoke" : "",
    getFlagBool("record") ? "evidence" : "",
    getFlagBool("rollback") ? "rollback" : "",
  ].filter(Boolean);
  if (selected.length > 1) {
    throw new Error("provider-capability hook accepts exactly one phase flag");
  }
  const phase = selected[0] || getFlagStr("provider-capability-phase", "apply").trim();
  assertSupportedPhase(phase);
  return phase;
}
