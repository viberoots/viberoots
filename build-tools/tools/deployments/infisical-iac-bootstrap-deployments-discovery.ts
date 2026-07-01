import * as fs from "node:fs";
import * as path from "node:path";
import type { GraphNode } from "../lib/graph";
import { readCompositeGraph } from "../lib/graph-view";
import { normalizeTargetLabel } from "../lib/labels";
import { findRepoRoot } from "../lib/repo";
import {
  defaultDeploymentGraphPath,
  deploymentGraphReadOptions,
} from "./deployment-graph-read-options";
import { resolveDeploymentContextNodes } from "./deployment-contexts";
import { resolveAllDeployments } from "./deployment-query";
import { errorMessage } from "./infisical-iac-bootstrap-redaction";
import type { DeploymentTarget } from "./contract";
import type { DeploymentBootstrapDiscovery } from "./infisical-iac-bootstrap-deployments";

export async function discoverDeploymentBootstrapTargets(
  opts: {
    workspaceRoot?: string;
    graphPath?: string;
  } = {},
): Promise<DeploymentBootstrapDiscovery> {
  const workspaceRoot = opts.workspaceRoot || (await findRepoRoot(process.cwd()));
  const graphPath = opts.graphPath || defaultDeploymentGraphPath(workspaceRoot);
  const fromGraph = await discoverFromGraph(graphPath, workspaceRoot);
  if (fromGraph.offeredTargets.length || fromGraph.unsupportedTargets.length) return fromGraph;
  if (!hasBuckConfig(workspaceRoot)) {
    return {
      ...fromGraph,
      source: "unavailable",
      warning: `deployment bootstrap target discovery unavailable: .buckconfig not found in ${workspaceRoot}`,
    };
  }
  try {
    return classifyDeploymentTargets(await resolveAllDeployments(workspaceRoot), "buck");
  } catch (error) {
    return {
      ...fromGraph,
      source: "unavailable",
      warning: `deployment bootstrap target discovery unavailable: ${errorMessage(error)}`,
    };
  }
}

function hasBuckConfig(workspaceRoot: string): boolean {
  try {
    return fs.existsSync(path.join(workspaceRoot, ".buckconfig"));
  } catch {
    return false;
  }
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

async function discoverFromGraph(
  graphPath: string,
  workspaceRoot = process.cwd(),
): Promise<DeploymentBootstrapDiscovery> {
  const nodes = await readCompositeGraph(deploymentGraphReadOptions(workspaceRoot, graphPath))
    .then((graph) => graph.nodes)
    .catch(() => []);
  const contextErrors: string[] = [];
  const contextResolvedNodes = resolveDeploymentContextNodes(nodes, contextErrors, workspaceRoot);
  if (contextErrors.length > 0) {
    return {
      offeredTargets: [],
      unsupportedTargets: contextErrors.map(contextErrorTarget),
      source: "graph",
    };
  }
  return classifyCandidates(
    contextResolvedNodes.filter(isInfisicalDeploymentNode).map((node) => ({
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
    if (candidate.family && targetMatchesFamily(candidate.target, candidate.family)) {
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
  return candidate.family
    ? "deployment target path does not match its reviewed deployment family"
    : "deployment does not declare a reviewed deployment family";
}

function targetMatchesFamily(target: string, family: string) {
  return new RegExp(`^//projects/deployments/${escapeRegex(family)}/[^/:]+:deploy$`).test(target);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contextErrorTarget(error: string) {
  const [target, ...reason] = error.split(": ");
  return {
    target: normalizeTargetLabel(target || ""),
    reason: reason.join(": ") || error,
  };
}

function stringAttr(node: GraphNode, key: string) {
  const value = node[key];
  return typeof value === "string" ? value.trim() : "";
}

function recordAttr(node: GraphNode, key: string) {
  const value = node[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
