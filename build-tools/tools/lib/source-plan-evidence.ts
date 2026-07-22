import fs from "node:fs/promises";
import { sourcePlanEvidenceFromGraph } from "./source-plan-evidence-core";

export * from "./source-plan-evidence-core";

export async function sourcePlanEvidenceFromGraphFile(file: string) {
  if (!file) return [];
  try {
    return sourcePlanEvidenceFromGraph(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    return [];
  }
}
