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
  if (Array.isArray(data)) return data as GraphNode[];
  if (data && typeof data === "object") return Object.values(data) as GraphNode[];
  return [];
}
