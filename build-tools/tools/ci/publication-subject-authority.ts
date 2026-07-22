import crypto from "node:crypto";
import type { PublicationSubject } from "./artifact-reproducibility-aggregate";

type GraphNode = {
  name?: unknown;
  labels?: unknown;
  protection_class?: unknown;
  components?: unknown;
};

export function resolvePublicationSubjects(graph: unknown): PublicationSubject[] {
  const consumers = new Map<string, { outputRole: string; deployments: Set<string> }>();
  for (const node of graphNodes(graph)) {
    const labels = strings(node.labels);
    if (!labels.includes("kind:deployment") || node.protection_class !== "production_facing") {
      continue;
    }
    const deployment = target(node.name, "production deployment");
    if (!Array.isArray(node.components) || !node.components.length) {
      throw new Error(`production deployment has no declared components: ${deployment}`);
    }
    for (const raw of node.components) {
      const component = record(raw, `component of ${deployment}`);
      const componentTarget = target(component.target, `component target of ${deployment}`);
      const outputRole = required(component.kind, `component kind of ${deployment}`);
      const current = consumers.get(componentTarget);
      if (current && current.outputRole !== outputRole) {
        throw new Error(`publication component has conflicting output roles: ${componentTarget}`);
      }
      const entry = current || { outputRole, deployments: new Set<string>() };
      entry.deployments.add(deployment);
      consumers.set(componentTarget, entry);
    }
  }
  if (!consumers.size) throw new Error("production graph has no publishable deployment components");
  const basis = [...consumers]
    .map(([componentTarget, entry]) => ({
      kind: "publication" as const,
      subjectId: `${entry.outputRole}:${componentTarget}`,
      target: componentTarget,
      deploymentComponents: [...entry.deployments].sort(),
      outputRole: entry.outputRole,
    }))
    .sort((left, right) => left.subjectId.localeCompare(right.subjectId));
  const subjectSetDigest = digest({ graphDigest: digest(graph), subjects: basis });
  return basis.map((subject) => ({ ...subject, subjectSetDigest }));
}

function graphNodes(value: unknown): GraphNode[] {
  const graph = record(value, "production graph");
  if (!Array.isArray(graph.nodes)) throw new Error("production graph requires canonical nodes");
  return graph.nodes.map((node) => record(node, "production graph node"));
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function target(value: unknown, name: string): string {
  const result = required(value, name).replace(/^root\/\//u, "//");
  if (!/^\/\/[^:]+:[^:]+$/u.test(result)) throw new Error(`${name} is not a canonical target`);
  return result;
}

function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function record(value: unknown, name: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, any>;
}

function digest(value: unknown): string {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
