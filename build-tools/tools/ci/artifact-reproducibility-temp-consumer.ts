import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { claimBundleTempRoot } from "../dev/evaluation-bundle-owner";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { withOwnedTempCleanup } from "../lib/owned-temp-cleanup";
import { reproducibilityMatrixCase } from "../lib/artifact-reproducibility-matrix";
import { resolveArtifactReproducibilityGraphContract } from "./artifact-reproducibility-matrix-binding";
import { runArtifactTool, type ArtifactCommandInternalEnv } from "./artifact-command";
import { writeVerifiedOwnedRootCleanupProof } from "./artifact-reproducibility-cleanup-proof";

export async function withArtifactReproducibilityTempConsumer<T>(opts: {
  matrixId: string;
  ownerRoot: string;
  artifactToolsRoot: string;
  cleanupProofFile: string;
  onPhase?: (phase: "temp-consumer-scaffold" | "owned-root-cleanup", elapsedMs: number) => void;
  operation: (workspaceRoot: string, sourceRevision: string) => Promise<T>;
}): Promise<T> {
  const matrixCase = reproducibilityMatrixCase(opts.matrixId);
  const immutableSource = path.join(opts.artifactToolsRoot, "share", "viberoots-source");
  assertImmutableSource(immutableSource);
  const scaffoldStarted = performance.now();
  await fs.mkdir(opts.ownerRoot, { recursive: true, mode: 0o700 });
  const ownedRoot = await fs.mkdtemp(path.join(opts.ownerRoot, `.repro-${matrixCase.id}-`));
  const artifactEnv = buildCanonicalArtifactEnvironment(ownedRoot, {
    artifactToolsRoot: opts.artifactToolsRoot,
  });
  const ownership = await claimBundleTempRoot(ownedRoot, artifactEnv);
  let scaffoldRecorded = false;
  let cleanupStarted = 0;
  const result = await withOwnedTempCleanup(
    async () => {
      const workspaceRoot = path.join(ownedRoot, "consumer");
      await fs.mkdir(workspaceRoot, { mode: 0o700 });
      const run = async (tool: string, args: string[], internalEnv?: ArtifactCommandInternalEnv) =>
        await runArtifactTool({
          tool,
          args,
          workspaceRoot,
          artifactToolsRoot: opts.artifactToolsRoot,
          internalEnv,
        });
      await run("git", ["init", "--initial-branch=main"]);
      await run("zx-wrapper", [
        path.join(immutableSource, "build-tools/tools/dev/viberoots.ts"),
        "init-consumer",
        "--mode",
        "flake",
        "--viberoots-url",
        `path:${immutableSource}`,
        "--workspace-root",
        workspaceRoot,
        "--workspace-name",
        `repro-${matrixCase.id}`,
        "--setup-direnv",
        "never",
      ]);
      const recipe = matrixCase.scaffoldRecipe;
      await run("zx-wrapper", [
        path.join(immutableSource, "build-tools/tools/scaffolding/scaf.ts"),
        "new",
        recipe.language,
        recipe.template,
        recipe.name,
        "--yes",
        `--path=${recipe.destination}`,
      ]);
      await run("bash", [path.join(immutableSource, "bootstrap")], {
        VBR_UPDATE: "1",
        VBR_WORKSPACE_ROOT: workspaceRoot,
        VBR_CONSUMER: "flake",
        VBR_RUN_INSTALL: "0",
        VBR_DIRENV_ALLOW: "0",
        VBR_VIBEROOTS_URL: `path:${immutableSource}`,
      });
      const gitEnv = {
        GIT_AUTHOR_NAME: "Viberoots Reproducibility",
        GIT_AUTHOR_EMAIL: "reproducibility@viberoots.invalid",
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_NAME: "Viberoots Reproducibility",
        GIT_COMMITTER_EMAIL: "reproducibility@viberoots.invalid",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      };
      await run("git", ["add", "--all"], gitEnv);
      await run(
        "git",
        ["commit", "--no-gpg-sign", "-m", `reproducibility: ${matrixCase.id}`],
        gitEnv,
      );
      const sourceRevision = (await run("git", ["rev-parse", "HEAD"], gitEnv)).stdout.trim();
      if (!/^[a-f0-9]{40,64}$/u.test(sourceRevision))
        throw new Error("temp consumer commit failed");
      const graph = JSON.parse(
        await fs.readFile(path.join(workspaceRoot, DEFAULT_GRAPH_PATH), "utf8"),
      ) as unknown;
      resolveArtifactReproducibilityGraphContract(matrixCase.id, graph);
      opts.onPhase?.("temp-consumer-scaffold", Math.round(performance.now() - scaffoldStarted));
      scaffoldRecorded = true;
      return await opts.operation(workspaceRoot, sourceRevision);
    },
    async () => {
      cleanupStarted = performance.now();
      await ownership.cleanup();
    },
  );
  if (!scaffoldRecorded) throw new Error("temp consumer scaffold timing was not recorded");
  await writeVerifiedOwnedRootCleanupProof(opts.cleanupProofFile, ownedRoot);
  opts.onPhase?.("owned-root-cleanup", Math.round(performance.now() - cleanupStarted));
  return result;
}

function assertImmutableSource(value: string): void {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/share\/viberoots-source$/u.test(value)) {
    throw new Error("temp consumers require the reviewed immutable viberoots source closure");
  }
}
