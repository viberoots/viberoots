import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { claimBundleTempRoot } from "../dev/evaluation-bundle-owner";
import { refreshGlueAndExportGraph } from "../dev/dev-build/glue";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { withOwnedTempCleanup } from "../lib/owned-temp-cleanup";
import { reproducibilityMatrixCase } from "../lib/artifact-reproducibility-matrix";
import { resolveArtifactReproducibilityGraphContract } from "./artifact-reproducibility-matrix-binding";
import { runArtifactTool, type ArtifactCommandInternalEnv } from "./artifact-command";
import { writeVerifiedOwnedRootCleanupProof } from "./artifact-reproducibility-cleanup-proof";
import { REVIEWED_CONSUMER_NIXPKGS_23_11_LOCK } from "./artifact-reproducibility-consumer-lock";
import type { NixCachePolicyCapability } from "../lib/nix-cache-policy-capability";

export async function withArtifactReproducibilityTempConsumer<T>(opts: {
  matrixId: string;
  ownerRoot: string;
  artifactToolsRoot: string;
  cleanupProofFile: string;
  baseEnv?: NodeJS.ProcessEnv;
  immutableSourceRoot?: string;
  nixCachePolicyCapability?: NixCachePolicyCapability;
  prepareWorkspaceState?: (workspaceRoot: string) => Promise<void>;
  prepareImmutableDependencies?: (workspaceRoot: string) => Promise<void>;
  onPhase?: (phase: "temp-consumer-scaffold" | "owned-root-cleanup", elapsedMs: number) => void;
  operation: (workspaceRoot: string, sourceRevision: string) => Promise<T>;
}): Promise<T> {
  const matrixCase = reproducibilityMatrixCase(opts.matrixId);
  const immutableSource =
    opts.immutableSourceRoot || path.join(opts.artifactToolsRoot, "share", "viberoots-source");
  assertImmutableSource(immutableSource);
  const reviewedSource = await fs.realpath(immutableSource);
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
          baseEnv: opts.baseEnv,
          internalEnv,
          nixCachePolicyCapability: opts.nixCachePolicyCapability,
        });
      const runTypeScript = async (script: string, args: string[]) =>
        await run(
          "node",
          [
            "--experimental-strip-types",
            "--experimental-top-level-await",
            "--disable-warning=ExperimentalWarning",
            "--import",
            path.join(immutableSource, "build-tools/tools/dev/zx-init.mjs"),
            script,
            ...args,
          ],
          { VIBEROOTS_SOURCE_ROOT: immutableSource },
        );
      await run("git", ["init", "--initial-branch=main"]);
      await fs.mkdir(path.join(workspaceRoot, ".viberoots/workspace"), { recursive: true });
      const sourceNarHash = (await run("nix", ["hash", "path", reviewedSource])).stdout.trim();
      await writeReviewedConsumerLock(workspaceRoot, reviewedSource, sourceNarHash);
      await runTypeScript(path.join(immutableSource, "build-tools/tools/dev/viberoots.ts"), [
        "init-consumer",
        "--mode",
        "flake",
        "--viberoots-url",
        `path:${reviewedSource}`,
        "--workspace-root",
        workspaceRoot,
        "--workspace-name",
        `repro-${matrixCase.id}`,
        "--setup-direnv",
        "never",
        "--no-lock",
      ]);
      const recipe = matrixCase.scaffoldRecipe;
      await runTypeScript(path.join(immutableSource, "build-tools/tools/scaffolding/scaf.ts"), [
        "new",
        recipe.language,
        recipe.template,
        recipe.name,
        "--yes",
        `--path=${recipe.destination}`,
      ]);
      await opts.prepareWorkspaceState?.(workspaceRoot);
      await run("bash", [path.join(immutableSource, "bootstrap")], {
        VBR_UPDATE: "1",
        VBR_WORKSPACE_ROOT: workspaceRoot,
        VBR_CONSUMER: "flake",
        VBR_RUN_INSTALL: "0",
        VBR_DIRENV_ALLOW: "0",
        VBR_BOOTSTRAP_SCAFFOLD_ONLY: "1",
        VBR_VIBEROOTS_URL: `path:${reviewedSource}`,
      });
      await runTypeScript(path.join(immutableSource, "build-tools/tools/dev/startup-check.ts"), []);
      await opts.prepareImmutableDependencies?.(workspaceRoot);
      await refreshGlueAndExportGraph(workspaceRoot, opts.artifactToolsRoot);
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

async function writeReviewedConsumerLock(
  workspaceRoot: string,
  immutableSource: string,
  sourceNarHash: string,
): Promise<void> {
  if (!/^sha256-[A-Za-z0-9+/=]+$/u.test(sourceNarHash)) {
    throw new Error("reviewed consumer source has an invalid NAR hash");
  }
  const sourceLock = JSON.parse(
    await fs.readFile(path.join(immutableSource, "flake.lock"), "utf8"),
  ) as { nodes: Record<string, unknown>; root: string; version: number };
  const sourceRoot = sourceLock.nodes[sourceLock.root] as { inputs: Record<string, string> };
  const lock = {
    ...sourceLock,
    nodes: {
      ...sourceLock.nodes,
      nixpkgs_23_11: REVIEWED_CONSUMER_NIXPKGS_23_11_LOCK,
      viberoots: {
        inputs: {
          buck2: ["buck2"],
          gomod2nix: ["gomod2nix"],
          nixpkgs: ["nixpkgs"],
          "rust-overlay": sourceRoot.inputs["rust-overlay"],
          "wasmtime-nixpkgs": sourceRoot.inputs["wasmtime-nixpkgs"],
        },
        locked: { narHash: sourceNarHash, path: immutableSource, type: "path" },
        original: { path: immutableSource, type: "path" },
      },
      root: {
        inputs: {
          buck2: sourceRoot.inputs.buck2,
          gomod2nix: sourceRoot.inputs.gomod2nix,
          nixpkgs: sourceRoot.inputs.nixpkgs,
          nixpkgs_23_11: "nixpkgs_23_11",
          "rust-overlay": sourceRoot.inputs["rust-overlay"],
          viberoots: "viberoots",
          "wasmtime-nixpkgs": sourceRoot.inputs["wasmtime-nixpkgs"],
        },
      },
    },
  };
  await fs.writeFile(
    path.join(workspaceRoot, ".viberoots/workspace/flake.lock"),
    `${JSON.stringify(lock, null, 2)}\n`,
  );
}

function assertImmutableSource(value: string): void {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/share\/viberoots-source$/u.test(value)) {
    throw new Error("temp consumers require the reviewed immutable viberoots source closure");
  }
}
