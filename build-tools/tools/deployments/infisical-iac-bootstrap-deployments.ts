import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { readGraph, type GraphNode } from "../lib/graph";
import { normalizeTargetLabel } from "../lib/labels";
import { resolveAllDeployments } from "./deployment-query";
import { askConfirmation, isAffirmativeConfirmation } from "./infisical-iac-bootstrap-preflight";
import { errorMessage } from "./infisical-iac-bootstrap-redaction";
import type { BootstrapArgs } from "./infisical-iac-bootstrap-types";
import type { DeploymentTarget } from "./contract";

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
  failures: Array<{ target: string; message: string }>;
};

type FanOutIo = {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  question?: (prompt: string) => Promise<string>;
  stderr?: (text: string) => void;
};

const SUPPORTED_TARGETS = new Set([
  "//projects/deployments/pleomino-staging:deploy",
  "//projects/deployments/pleomino-prod:deploy",
]);

export async function discoverDeploymentBootstrapTargets(
  opts: {
    workspaceRoot?: string;
    graphPath?: string;
  } = {},
): Promise<DeploymentBootstrapDiscovery> {
  const graphPath = opts.graphPath || DEFAULT_GRAPH_PATH;
  const fromGraph = await discoverFromGraph(graphPath);
  if (fromGraph.offeredTargets.length || fromGraph.unsupportedTargets.length) return fromGraph;
  try {
    return classifyDeploymentTargets(
      await resolveAllDeployments(opts.workspaceRoot || process.cwd()),
      "buck",
    );
  } catch (error) {
    return {
      ...fromGraph,
      source: "unavailable",
      warning: `deployment bootstrap target discovery unavailable: ${errorMessage(error)}`,
    };
  }
}

export async function buildDeploymentFanOutDryRunReport(args: BootstrapArgs) {
  const discovery = await discoverDeploymentBootstrapTargets();
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
  execute: (args: BootstrapArgs) => Promise<void>;
  discover?: () => Promise<DeploymentBootstrapDiscovery>;
  io?: FanOutIo;
}): Promise<DeploymentBootstrapFanOutResult> {
  const stderr = opts.io?.stderr || console.error;
  if (opts.args.withoutDeployments) {
    stderr("Deployment bootstrap fan-out skipped by --without-deployments.");
    return emptyFanOut({ offeredTargets: [], unsupportedTargets: [], source: "unavailable" }, true);
  }
  const discovery = await (opts.discover || discoverDeploymentBootstrapTargets)();
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

function classifyDeploymentTargets(
  deployments: DeploymentTarget[],
  source: "graph" | "buck",
): DeploymentBootstrapDiscovery {
  return classifyCandidates(
    deployments
      .filter((deployment) => deployment.secretBackend === "infisical")
      .map((deployment) => ({
        target: deployment.label,
        family: deployment.deploymentFamily,
      })),
    source,
  );
}

async function discoverFromGraph(graphPath: string): Promise<DeploymentBootstrapDiscovery> {
  const nodes = await readGraph(graphPath).catch(() => []);
  return classifyCandidates(
    nodes.filter(isInfisicalDeploymentNode).map((node) => ({
      target: normalizeTargetLabel(String(node.name || "")),
      family: stringAttr(node, "deployment_family"),
    })),
    "graph",
  );
}

function classifyCandidates(
  candidates: Array<{ target: string; family?: string }>,
  source: "graph" | "buck",
): DeploymentBootstrapDiscovery {
  const offered = new Set<string>();
  const unsupported = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate.target) continue;
    if (SUPPORTED_TARGETS.has(candidate.target) && candidate.family === "pleomino") {
      offered.add(candidate.target);
      continue;
    }
    unsupported.set(candidate.target, unsupportedReason(candidate));
  }
  return {
    offeredTargets: [...offered].sort(),
    unsupportedTargets: [...unsupported.entries()]
      .map(([target, reason]) => ({ target, reason }))
      .sort((left, right) => left.target.localeCompare(right.target)),
    source,
  };
}

function isInfisicalDeploymentNode(node: GraphNode) {
  return Boolean(
    normalizeTargetLabel(String(node.name || "")) &&
      (stringAttr(node, "secret_backend").startsWith("infisical/") ||
        Object.keys(recordAttr(node, "infisical_runtime")).length > 0),
  );
}

function unsupportedReason(candidate: { family?: string }) {
  return candidate.family === "pleomino"
    ? "Infisical bootstrap currently supports only reviewed Pleomino staging/prod targets"
    : "deployment does not match a reviewed Infisical bootstrap family";
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

function emptyFanOut(
  discovery: DeploymentBootstrapDiscovery,
  skipped: boolean,
): DeploymentBootstrapFanOutResult {
  return { offeredTargets: discovery.offeredTargets, skipped, successes: [], failures: [] };
}

async function executeDeploymentTargets(
  args: BootstrapArgs,
  targets: string[],
  execute: (args: BootstrapArgs) => Promise<void>,
  stderr: (text: string) => void,
) {
  const result = emptyFanOut(
    { offeredTargets: targets, unsupportedTargets: [], source: "graph" },
    false,
  );
  for (const target of targets) {
    try {
      await execute({ ...args, mode: "deployment", target, yes: true, withoutDeployments: false });
      result.successes.push(target);
      stderr(`Deployment bootstrap succeeded: ${target}`);
    } catch (error) {
      const message = errorMessage(error);
      result.failures.push({ target, message });
      stderr(`Deployment bootstrap failed: ${target}\n${message}`);
    }
  }
  if (result.failures.length > 0) throw fanOutFailure(result.failures);
  stderr(`Deployment bootstrap fan-out completed: ${result.successes.join(", ")}`);
  return result;
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

function stringAttr(node: GraphNode, key: string) {
  const value = node[key];
  return typeof value === "string" ? value.trim() : "";
}

function recordAttr(node: GraphNode, key: string) {
  const value = node[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
