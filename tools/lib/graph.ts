import * as fsp from "node:fs/promises";

export type GraphNode = {
  name?: string;
  rule_type?: string;
  labels?: string[];
  [key: string]: any;
};

export async function readGraph(graphPath: string): Promise<GraphNode[]> {
  const txt = await fsp.readFile(graphPath, "utf8");
  const data = JSON.parse(txt);
  // Preferred: schema-wrapped object { $schema, version, nodes: [...] }
  if (data && typeof data === "object" && Array.isArray((data as any).nodes)) {
    return (data as any).nodes as GraphNode[];
  }
  // Back-compat: plain array of nodes
  if (Array.isArray(data)) return data as GraphNode[];
  // Legacy: object map of target -> node
  if (data && typeof data === "object") return Object.values(data) as GraphNode[];
  return [];
}
