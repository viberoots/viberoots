import { errorMessage } from "./infisical-iac-bootstrap-redaction";
import { requireConsistentMetadataHandoffs } from "./infisical-iac-bootstrap-handoff-consistency";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import type { MetadataHandoffPatch } from "./infisical-iac-bootstrap-metadata-handoff";
import type {
  DeploymentBootstrapDiscovery,
  DeploymentBootstrapExecutionResult,
  DeploymentBootstrapFanOutResult,
} from "./infisical-iac-bootstrap-deployments";

export function emptyFanOut(
  discovery: DeploymentBootstrapDiscovery,
  skipped: boolean,
): DeploymentBootstrapFanOutResult {
  return {
    offeredTargets: discovery.offeredTargets,
    skipped,
    successes: [],
    metadataHandoffs: [],
    failures: [],
  };
}

export async function executeDeploymentTargets(
  args: BootstrapArgs,
  targets: string[],
  execute: (args: BootstrapArgs) => Promise<DeploymentBootstrapExecutionResult | void>,
  stderr: (text: string) => void,
) {
  const result = emptyFanOut(
    { offeredTargets: targets, unsupportedTargets: [], source: "graph" },
    false,
  );
  for (const target of targets) {
    try {
      await recordExecution(result, target, await execute(deploymentArgs(args, target)), stderr);
    } catch (error) {
      const message = errorMessage(error);
      result.failures.push({ target, message });
      stderr(`Deployment bootstrap failed: ${target}\n${message}`);
    }
  }
  if (result.failures.length > 0) throw fanOutFailure(result.failures);
  reportHandoffs(result.metadataHandoffs, stderr);
  stderr(`Deployment bootstrap fan-out completed: ${result.successes.join(", ")}`);
  return result;
}

function deploymentArgs(args: BootstrapArgs, target: string): BootstrapArgs {
  return { ...args, mode: "deployment", target, yes: true, withoutDeployments: false };
}

async function recordExecution(
  result: DeploymentBootstrapFanOutResult,
  target: string,
  executed: DeploymentBootstrapExecutionResult | void,
  stderr: (text: string) => void,
) {
  const patch = executed?.reconciliation?.patch;
  if (executed?.reconciliation?.status === "metadata_handoff_required" && patch) {
    result.metadataHandoffs.push({ target, patch });
    stderr(`Deployment bootstrap awaits reviewed metadata handoff: ${target}`);
    return;
  }
  result.successes.push(target);
  stderr(`Deployment bootstrap succeeded: ${target}`);
}

function reportHandoffs(
  handoffs: Array<{ target: string; patch: MetadataHandoffPatch }>,
  stderr: (text: string) => void,
) {
  if (handoffs.length === 0) return;
  const patch = requireConsistentMetadataHandoffs(handoffs)!;
  stderr(
    `First-bootstrap metadata handoff required for: ${handoffs.map((i) => i.target).join(", ")}`,
  );
  stderr(patch.unifiedDiff);
}

function fanOutFailure(failures: Array<{ target: string; message: string }>) {
  return new Error(
    [
      "Repo bootstrap completed, but deployment bootstrap fan-out did not clear all managed outputs.",
      ...failures.map((failure) => `${failure.target}: ${failure.message}`),
      "Retry a failed scope with deployment --target <buck-target>.",
    ].join("\n"),
  );
}
