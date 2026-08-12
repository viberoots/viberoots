import fs from "node:fs/promises";
import path from "node:path";

export async function matrixCellRecordFiles(recordRoot: string): Promise<{
  recordPath: string;
  observationPath: string;
}> {
  const recordPath = path.join(recordRoot, "run-record.json");
  const record = JSON.parse(await fs.readFile(recordPath, "utf8")) as {
    observationStorePath?: unknown;
  };
  const observationPath = String(record.observationStorePath || "");
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/run-observation\.json$/u.test(observationPath)) {
    throw new Error("reproducibility record omitted its immutable observation path");
  }
  return { recordPath, observationPath };
}

export function matrixCellScript(artifactToolsRoot: string, name: string): string {
  return path.join(artifactToolsRoot, "share/viberoots-source/build-tools/tools/ci", name);
}

export function matrixCellStorePath(value: string): string {
  const paths = value.trim().split(/\s+/u).filter(Boolean);
  if (paths.length !== 1 || !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(paths[0]!)) {
    throw new Error("reproducibility producer must return exactly one immutable record root");
  }
  return paths[0]!;
}
