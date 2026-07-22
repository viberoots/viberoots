import { readProtectedReproducibilityAggregate } from "../lib/protected-reproducibility-aggregate";
import { runArtifactNix } from "./artifact-command";
import {
  systemReproducibilityOutputs,
  type SignedArtifactReproducibilityAggregate,
} from "./cache-publication-evidence";

type ArtifactContext = {
  workspaceRoot: string;
  artifactToolsRoot: string;
};

export async function readSignedReproducibilityAggregate(
  file: string,
  evidenceStoreLocator: string,
  context: ArtifactContext,
): Promise<SignedArtifactReproducibilityAggregate> {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/aggregate\.json$/u.test(file)) {
    throw new Error("cache publication requires an immutable signed aggregate store path");
  }
  const runNix = async (args: string[]) => await runArtifactNix({ args, ...context });
  return await readProtectedReproducibilityAggregate(file, evidenceStoreLocator, runNix);
}

export async function stageSystemReproducibilityOutputs(
  signed: SignedArtifactReproducibilityAggregate,
  system: string,
  context: ArtifactContext,
  runNix: (args: string[]) => Promise<void> = async (args) => {
    await runArtifactNix({ args, ...context });
  },
): Promise<void> {
  const paths = systemReproducibilityOutputs(signed, system).map(({ outputPath }) => outputPath);
  await runNix(["copy", "--from", signed.evidenceStoreUri, ...paths]);
  await runNix(["path-info", ...paths]);
}
