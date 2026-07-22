import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactReproducibilityEvidence } from "../lib/artifact-reproducibility-evidence";
import type { ArtifactReproducibilityObservation } from "../lib/artifact-reproducibility-observation";
import { runArtifactNix } from "./artifact-command";
import { createArtifactReproducibilityRunRecord } from "./artifact-reproducibility-aggregate";

export async function storeFinalizedArtifactRunRecord(opts: {
  localTempRoot: string;
  outputRoot: string;
  workspaceRoot: string;
  artifactToolsRoot: string;
  observation: ArtifactReproducibilityObservation;
  evidence: ArtifactReproducibilityEvidence;
}): Promise<string> {
  const context = { workspaceRoot: opts.workspaceRoot, artifactToolsRoot: opts.artifactToolsRoot };
  const observationRoot = path.join(opts.localTempRoot, "observation");
  await fs.mkdir(observationRoot, { recursive: false, mode: 0o700 });
  await fs.writeFile(
    path.join(observationRoot, "run-observation.json"),
    `${JSON.stringify(opts.observation, null, 2)}\n`,
    { flag: "wx", mode: 0o444 },
  );
  const storedObservation = await runArtifactNix({
    args: [
      "store",
      "add-path",
      "--name",
      "viberoots-artifact-reproducibility-observation-v4",
      observationRoot,
    ],
    ...context,
  });
  const observationStorePath = path.join(
    onlyPath(storedObservation.stdout),
    "run-observation.json",
  );
  await fs.mkdir(opts.outputRoot, { recursive: false, mode: 0o700 });
  const runRecord = createArtifactReproducibilityRunRecord({
    registryStorePath: opts.evidence.builderAuthority.registryStorePath,
    observationStorePath,
    evidence: opts.evidence,
  });
  await fs.writeFile(
    path.join(opts.outputRoot, "run-record.json"),
    `${JSON.stringify(runRecord, null, 2)}\n`,
    { flag: "wx", mode: 0o444 },
  );
  return onlyPath(
    (
      await runArtifactNix({
        args: [
          "store",
          "add-path",
          "--name",
          "viberoots-artifact-reproducibility-run-record-v3",
          opts.outputRoot,
        ],
        ...context,
      })
    ).stdout,
  );
}

function onlyPath(stdout: string): string {
  const values = stdout.trim().split(/\s+/u).filter(Boolean);
  if (values.length !== 1 || !values[0]!.startsWith("/nix/store/")) {
    throw new Error("artifact finalization must produce exactly one Nix store path");
  }
  return values[0]!;
}
