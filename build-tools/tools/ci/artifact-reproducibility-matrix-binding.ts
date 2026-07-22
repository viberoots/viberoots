import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  reproducibilityMatrixCase,
  type ReproducibilityMatrixCase,
} from "../lib/artifact-reproducibility-matrix";

type GraphNode = { name?: unknown; rule_type?: unknown; labels?: unknown; deps?: unknown };
type BundleSelection = { attr?: unknown; target?: unknown };

export type ArtifactReproducibilityMatrixBinding = {
  matrixId: string;
  artifactFamily: ReproducibilityMatrixCase["artifactFamily"];
  target: string;
  attr: "graph-generator-selected";
  ruleType: string;
  requiredLabels: readonly string[];
  languageProofs: ReproducibilityMatrixCase["languageProofs"];
  nodeArtifact?: ReproducibilityMatrixCase["nodeArtifact"];
  outputRole: string;
  flakeRef: string;
  bindingDigest: string;
};

export type ArtifactReproducibilityGraphContract = Omit<
  ArtifactReproducibilityMatrixBinding,
  "flakeRef"
>;

export async function resolveArtifactReproducibilityMatrixBinding(opts: {
  matrixId: string;
  evaluationBundleRoot: string;
}): Promise<ArtifactReproducibilityMatrixBinding> {
  assertStoreRoot(opts.evaluationBundleRoot);
  const [graph, selection, flakeSubdir] = await Promise.all([
    readJson(path.join(opts.evaluationBundleRoot, "graph.json")),
    readJson(path.join(opts.evaluationBundleRoot, "selection.json")),
    resolveFlakeSubdir(opts.evaluationBundleRoot),
  ]);
  return resolveArtifactReproducibilityMatrixBindingFromValues({
    ...opts,
    graph,
    selection,
    flakeSubdir,
  });
}

export function resolveArtifactReproducibilityMatrixBindingFromValues(opts: {
  matrixId: string;
  evaluationBundleRoot: string;
  graph: unknown;
  selection: unknown;
  flakeSubdir: string;
}): ArtifactReproducibilityMatrixBinding {
  assertStoreRoot(opts.evaluationBundleRoot);
  const contract = resolveArtifactReproducibilityGraphContract(opts.matrixId, opts.graph);
  const selection = record(opts.selection, "evaluation-bundle selection") as BundleSelection;
  if (selection.attr !== contract.attr || selection.target !== contract.target) {
    throw new Error(`evaluation bundle selection must bind ${contract.target}#${contract.attr}`);
  }
  return {
    ...contract,
    flakeRef: `path:${opts.evaluationBundleRoot}?dir=${path.posix.join("source", opts.flakeSubdir)}#${contract.attr}`,
  };
}

export function resolveArtifactReproducibilityGraphContract(
  matrixId: string,
  graph: unknown,
): ArtifactReproducibilityGraphContract {
  const matrixCase = reproducibilityMatrixCase(matrixId);
  const matches = graphNodes(graph).filter((node) => nodeMatches(node, matrixCase));
  if (matches.length !== 1) {
    throw new Error(
      `reproducibility matrix ${matrixCase.id} requires exactly one graph-contracted target; found ${matches.length}`,
    );
  }
  const node = matches[0]!;
  const reachable = dependencyClosure(node, graphNodes(graph), matrixCase.id);
  for (const proof of matrixCase.languageProofs) {
    const proofMatches = reachable.filter((candidate) => nodeMatchesProof(candidate, proof));
    if (proofMatches.length !== 1) {
      throw new Error(
        `reproducibility matrix ${matrixCase.id} language proof ${proof.target} requires exactly one reachable dependency; found ${proofMatches.length}`,
      );
    }
  }
  if (
    matrixCase.nodeArtifact?.nativeClosureTarget &&
    !matrixCase.languageProofs.some(
      ({ target }) => target === matrixCase.nodeArtifact?.nativeClosureTarget,
    )
  ) {
    throw new Error(`reproducibility matrix ${matrixCase.id} lacks its native closure proof`);
  }
  const contract = {
    matrixId: matrixCase.id,
    artifactFamily: matrixCase.artifactFamily,
    target: requiredString(node.name, "selected graph node name"),
    attr: matrixCase.graphSelection.attr,
    ruleType: requiredString(node.rule_type, "selected graph node rule_type"),
    requiredLabels: matrixCase.graphSelection.requiredLabels,
    languageProofs: matrixCase.languageProofs,
    outputRole: matrixCase.graphSelection.outputRole,
    ...(matrixCase.nodeArtifact ? { nodeArtifact: matrixCase.nodeArtifact } : {}),
  };
  return {
    ...contract,
    bindingDigest: digest(contract),
  };
}

function dependencyClosure(selected: GraphNode, nodes: GraphNode[], matrixId: string): GraphNode[] {
  const byName = new Map<string, GraphNode>();
  for (const node of nodes) {
    const name = requiredString(node.name, "graph node name");
    if (byName.has(name)) {
      throw new Error(`reproducibility matrix ${matrixId} graph contains duplicate node: ${name}`);
    }
    byName.set(name, node);
  }
  const pending = [...dependencies(selected, matrixId)];
  const reachable: GraphNode[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const name = pending.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const node = byName.get(name);
    if (!node) {
      throw new Error(
        `reproducibility matrix ${matrixId} dependency is absent from graph: ${name}`,
      );
    }
    reachable.push(node);
    pending.push(...dependencies(node, matrixId));
  }
  return reachable;
}

function dependencies(node: GraphNode, matrixId: string): string[] {
  if (node.deps === undefined) return [];
  if (!Array.isArray(node.deps) || node.deps.some((entry) => typeof entry !== "string")) {
    throw new Error(`reproducibility matrix ${matrixId} graph node has invalid dependencies`);
  }
  return node.deps;
}

function nodeMatchesProof(
  node: GraphNode,
  proof: ReproducibilityMatrixCase["languageProofs"][number],
): boolean {
  const labels = Array.isArray(node.labels)
    ? node.labels.filter((label) => typeof label === "string")
    : [];
  return (
    node.name === proof.target &&
    typeof node.rule_type === "string" &&
    proof.ruleTypes.includes(node.rule_type) &&
    proof.requiredLabels.every((label) => labels.includes(label))
  );
}

function graphNodes(value: unknown): GraphNode[] {
  const graph = record(value, "evaluation-bundle graph");
  if (!Array.isArray(graph.nodes)) {
    throw new Error("evaluation-bundle graph requires canonical schema-wrapped nodes");
  }
  return graph.nodes.map((node) => record(node, "evaluation-bundle graph node"));
}

function nodeMatches(node: GraphNode, matrixCase: ReproducibilityMatrixCase): boolean {
  const labels = Array.isArray(node.labels)
    ? node.labels.filter((label) => typeof label === "string")
    : [];
  return (
    typeof node.name === "string" &&
    node.name === matrixCase.graphSelection.target &&
    typeof node.rule_type === "string" &&
    matrixCase.graphSelection.ruleTypes.includes(node.rule_type) &&
    matrixCase.graphSelection.requiredLabels.every((label) => labels.includes(label))
  );
}

async function resolveFlakeSubdir(bundleRoot: string): Promise<string> {
  const workspace = path.join(bundleRoot, "source", ".viberoots", "workspace", "flake.nix");
  if (await exists(workspace)) return ".viberoots/workspace";
  if (await exists(path.join(bundleRoot, "source", "flake.nix"))) return ".";
  throw new Error("immutable evaluation bundle does not contain a canonical flake");
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function exists(file: string): Promise<boolean> {
  return await fs.access(file).then(
    () => true,
    () => false,
  );
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, any>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function assertStoreRoot(value: string): void {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(value)) {
    throw new Error("reproducibility matrix binding requires an immutable evaluation-bundle root");
  }
}

function digest(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
