import {
  emptyFanOut,
  executeDeploymentTargets,
} from "./infisical-iac-bootstrap-deployments-execute";
import { discoverDeploymentBootstrapTargets } from "./infisical-iac-bootstrap-deployments-discovery";
import { askConfirmation, isAffirmativeConfirmation } from "./infisical-iac-bootstrap-preflight";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import type { MetadataHandoffPatch } from "./infisical-iac-bootstrap-metadata-handoff";

export { discoverDeploymentBootstrapTargets };

export type DeploymentBootstrapDiscovery = {
  offeredTargets: string[];
  unsupportedTargets: Array<{ target: string; reason: string }>;
  source: "graph" | "buck" | "unavailable";
  warning?: string;
};

export type DeploymentBootstrapFanOutResult = {
  offeredTargets: string[];
  skipped: boolean;
  successes: string[];
  metadataHandoffs: Array<{ target: string; patch: MetadataHandoffPatch }>;
  failures: Array<{ target: string; message: string }>;
};

export type DeploymentBootstrapExecutionResult = {
  reconciliation?: { status?: string; patch?: MetadataHandoffPatch };
};

type FanOutIo = {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  question?: (prompt: string) => Promise<string>;
  stderr?: (text: string) => void;
};

export async function buildDeploymentFanOutDryRunReport(
  args: BootstrapArgs,
  opts: { workspaceRoot?: string; graphPath?: string } = {},
) {
  const discovery = await discoverDeploymentBootstrapTargets(opts);
  return {
    readOnly: true,
    suppressedByFlag: args.withoutDeployments,
    optOutFlag: "--without-deployments",
    source: discovery.source,
    offeredTargets: discovery.offeredTargets,
    unsupportedTargets: discovery.unsupportedTargets,
    ...(discovery.warning ? { warning: discovery.warning } : {}),
  };
}

export async function runDeploymentBootstrapFanOut(opts: {
  args: BootstrapArgs;
  workspaceRoot?: string;
  graphPath?: string;
  execute: (args: BootstrapArgs) => Promise<DeploymentBootstrapExecutionResult | void>;
  discover?: () => Promise<DeploymentBootstrapDiscovery>;
  io?: FanOutIo;
}): Promise<DeploymentBootstrapFanOutResult> {
  const stderr = opts.io?.stderr || console.error;
  if (opts.args.withoutDeployments) {
    stderr("Deployment bootstrap fan-out skipped by --without-deployments.");
    return emptyFanOut({ offeredTargets: [], unsupportedTargets: [], source: "unavailable" }, true);
  }
  const discovery = await (
    opts.discover ||
    (() =>
      discoverDeploymentBootstrapTargets({
        workspaceRoot: opts.workspaceRoot,
        graphPath: opts.graphPath,
      }))
  )();
  reportUnsupportedTargets(discovery, stderr);
  if (discovery.offeredTargets.length === 0) {
    stderr("No supported deployment bootstrap targets were discovered.");
    return emptyFanOut(discovery, false);
  }
  if (!(await confirmDeploymentFanOut(opts.args, discovery.offeredTargets, opts.io))) {
    stderr("Deployment bootstrap fan-out skipped by operator response.");
    return emptyFanOut(discovery, true);
  }
  return await executeDeploymentTargets(opts.args, discovery.offeredTargets, opts.execute, stderr);
}

export async function confirmDeploymentFanOut(
  args: BootstrapArgs,
  targets: string[],
  io: FanOutIo = {},
) {
  if (args.yes) return true;
  const stdin = io.stdin || process.stdin;
  const stdout = io.stdout || process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      [
        "Deployment bootstrap fan-out needs confirmation after repo bootstrap completes.",
        `Targets: ${targets.join(", ")}`,
        "Retry non-interactively with --yes, or suppress fan-out with --without-deployments.",
      ].join("\n"),
    );
  }
  const answer = await askConfirmation(
    `Run deployment bootstrap for ${targets.join(", ")}? [Y/n] `,
    io,
  );
  if (!isAffirmativeConfirmation(answer)) {
    return false;
  }
  return true;
}

function reportUnsupportedTargets(
  discovery: DeploymentBootstrapDiscovery,
  stderr: (text: string) => void,
) {
  for (const item of discovery.unsupportedTargets) {
    stderr(`Unsupported deployment bootstrap target: ${item.target} (${item.reason})`);
  }
  if (discovery.warning) stderr(discovery.warning);
}
