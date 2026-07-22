import * as fsp from "node:fs/promises";
import { sourcePlanEvidenceFromGraph } from "../lib/source-plan-evidence-core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function sourcePlanEvidenceFromGraphFile(file: string): Promise<unknown[]> {
  if (!file) return [];
  const raw: unknown = JSON.parse(await fsp.readFile(file, "utf8"));
  if (!Array.isArray(raw) && !isRecord(raw)) {
    throw new Error("source snapshot graph must be an array or object");
  }
  if (isRecord(raw) && "nodes" in raw && !Array.isArray(raw.nodes)) {
    throw new Error("source snapshot graph nodes must be an array");
  }
  return sourcePlanEvidenceFromGraph(raw);
}
