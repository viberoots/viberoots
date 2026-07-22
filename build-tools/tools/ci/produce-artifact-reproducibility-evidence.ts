#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { withArtifactCommandLifecycle } from "../lib/artifact-command-runner";
import {
  artifactTransportEnvironment,
  buildCanonicalArtifactEnvironment,
} from "../lib/artifact-environment";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  reproducibilityRecipeDigest,
} from "../lib/artifact-reproducibility-matrix";
import { assertReproducibilityNodeArtifact } from "../lib/artifact-reproducibility-node-contract";
import { resolveArtifactReproducibilityMatrixBinding } from "./artifact-reproducibility-matrix-binding";
import { resolveArtifactPublicationBinding } from "./artifact-reproducibility-publication-binding";
import {
  parseRemoteBuilderSystem,
  type RemoteBuilderPolicy,
} from "../remote-exec/nix-remote-builder-config";
import { runRemoteBuilderSmoke } from "../remote-exec/nix-remote-builder-smoke";
import { withActiveReviewedRemoteNix } from "../remote-exec/active-reviewed-remote-nix";
import { parseReviewedRemoteBuilders } from "../remote-exec/remote-builder-authority";
import { enterCanonicalArtifactEntrypoint } from "../dev/canonical-artifact-entrypoint";
import { runArtifactNix } from "./artifact-command";
import {
  opaqueIdentity,
  produceArtifactReproducibilityEvidence,
} from "./artifact-reproducibility-producer";
import { observeArtifactReproducibility } from "./artifact-reproducibility-observer";
import { readVerifiedOwnedRootCleanupProof } from "./artifact-reproducibility-cleanup-proof";
import { storeFinalizedArtifactRunRecord } from "./artifact-reproducibility-record-storage";
import { ArtifactProcessLifecycle } from "./artifact-reproducibility-process-evidence";
import {
  readStoreInventory,
  type StoreInventory,
} from "./artifact-reproducibility-store-observation";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint();

async function main(): Promise<void> {
  const bundleSourceRoot = required("bundle-source-root");
  const replayBundleSourceRoot = required("replay-bundle-source-root");
  const bundleRoot = path.dirname(bundleSourceRoot);
  if (!bundleSourceRoot.startsWith("/nix/store/") || !bundleSourceRoot.endsWith("/source")) {
    throw new Error("reproducibility production requires an evaluation-bundle source store path");
  }
  const matrixId = getFlagStr("matrix-id", "").trim();
  const publicationSubjectId = getFlagStr("publication-subject-id", "").trim();
  if (Boolean(matrixId) === Boolean(publicationSubjectId)) {
    throw new Error("select exactly one matrix or production publication subject authority");
  }
  const binding = matrixId
    ? await resolveArtifactReproducibilityMatrixBinding({
        matrixId,
        evaluationBundleRoot: bundleRoot,
      })
    : await resolveArtifactPublicationBinding({
        subjectId: publicationSubjectId,
        evaluationBundleRoot: bundleRoot,
      });
  const replayBinding = matrixId
    ? await resolveArtifactReproducibilityMatrixBinding({
        matrixId,
        evaluationBundleRoot: path.dirname(replayBundleSourceRoot),
      })
    : await resolveArtifactPublicationBinding({
        subjectId: publicationSubjectId,
        evaluationBundleRoot: path.dirname(replayBundleSourceRoot),
      });
  const bundleDigest = required("bundle-digest");
  if (
    bundleSourceRoot !== replayBundleSourceRoot ||
    binding.bindingDigest !== replayBinding.bindingDigest ||
    binding.bindingDigest !== required("binding-digest")
  ) {
    throw new Error("replayed evaluation bundle changed source root, digest, or matrix binding");
  }
  const flakeRef = binding.flakeRef;
  const context = { workspaceRoot: process.cwd(), artifactToolsRoot };
  const evidenceToolEnv = buildCanonicalArtifactEnvironment(process.cwd(), { artifactToolsRoot });
  const system = parseRemoteBuilderSystem(required("system"));
  const policy = required("builder-policy") as RemoteBuilderPolicy;
  const reviewedBuilders = required("reviewed-builders");
  const registry = parseReviewedRemoteBuilders(
    JSON.parse(await fs.readFile(reviewedBuilders, "utf8")),
  );
  const outputRoot = path.resolve(required("output-root"));
  const localTempRoot = path.dirname(outputRoot);
  const checkoutIdentity = opaqueIdentity(process.cwd());
  const cleanupProof = getFlagStr("owned-root-cleanup-proof", "").trim();
  const cleanup = cleanupProof
    ? await readVerifiedOwnedRootCleanupProof(cleanupProof)
    : { status: "not-applicable" as const, ownedRoot: undefined };
  const remoteOptions = {
    remoteCiTools: required("remote-ci-tools"),
    transportFile: required("transport-file"),
    policy,
    expectedSystem: system,
    builderIdentity: required("builder-identity"),
    reviewedBuilders,
    baseEnv: artifactTransportEnvironment(process.env),
  };
  const lifecycle = new ArtifactProcessLifecycle({ env: evidenceToolEnv });
  let remoteStoreBefore: StoreInventory | undefined;
  let remoteStoreAfterProbes: StoreInventory | undefined;
  const observed = await withArtifactCommandLifecycle(lifecycle, async () => {
    const activeSmoke = await runRemoteBuilderSmoke({
      ...remoteOptions,
      probeFlake: required("probe-flake"),
      probeStoreObservation: {
        before: async (runNix) => {
          remoteStoreBefore = await readStoreInventory(runNix);
        },
        after: async (runNix) => {
          remoteStoreAfterProbes = await readStoreInventory(runNix);
        },
      },
    });
    if (!remoteStoreBefore || !remoteStoreAfterProbes) {
      throw new Error("remote builder smoke omitted its store observation boundary");
    }
    const remoteProbePaths = new Set(
      [...remoteStoreAfterProbes].flatMap(([storePath]) =>
        remoteStoreBefore!.has(storePath) ? [] : [storePath],
      ),
    );
    return await withActiveReviewedRemoteNix(
      { ...remoteOptions, activeSmoke },
      async ({ builderAuthority, copyToEvidenceStore, runNix }) => {
        const captured = await observeArtifactReproducibility({
          runRemoteNix: runNix,
          runLocalNix: async (args) => await runArtifactNix({ args, ...context }),
          cellObservationInput: required("cell-observation-input"),
          ownedRootCleanup: cleanup.status,
          cleanedOwnedRoot: cleanup.ownedRoot,
          localTempRoot,
          evaluationBundleRoots: [bundleRoot, path.dirname(replayBundleSourceRoot)],
          evidenceToolEnv,
          lifecycle,
          remoteStoreBefore,
          remoteProbePaths,
          operation: async (observedRunNix) => {
            const outputPath = onlyPath(
              (await observedRunNix(["build", "--no-link", "--print-out-paths", flakeRef])).stdout,
            );
            await assertReproducibilityNodeArtifact({
              contract: "nodeArtifact" in binding ? binding.nodeArtifact : undefined,
              evaluationBundleSourceRoot: bundleSourceRoot,
              outputPath,
              runNix: observedRunNix,
            });
            return await produceArtifactReproducibilityEvidence(
              {
                evaluationBundleRoot: bundleSourceRoot,
                replayEvaluationBundleRoot: replayBundleSourceRoot,
                expectedEvaluationBundleDigest: bundleDigest,
                expectedBindingDigest: binding.bindingDigest,
                system,
                flakeRef,
                outputPath,
                subjectAuthority:
                  "subject" in binding
                    ? binding.subject
                    : {
                        kind: "matrix",
                        matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
                        matrixId: binding.matrixId,
                        artifactFamily: binding.artifactFamily,
                        recipeDigest: reproducibilityRecipeDigest(binding.matrixId),
                        bindingDigest: binding.bindingDigest,
                        target: binding.target,
                      },
                checkoutIdentity,
                builderAuthority,
              },
              observedRunNix,
            );
          },
          afterOperation: async (produced) =>
            await copyToEvidenceStore({
              storeUri: registry.evidenceStore.storeUri,
              storePaths: [produced.outputPath],
              awsSharedCredentialsFile: required("evidence-store-aws-credentials-file"),
            }),
          describe: (produced) => ({
            subjectId:
              produced.subjectAuthority.kind === "matrix"
                ? produced.subjectAuthority.matrixId
                : produced.subjectAuthority.subjectId,
            system: produced.system,
            checkoutIdentity: produced.checkoutIdentity,
            builderIdentity: produced.builderAuthority.identity,
            artifactOutputPath: produced.outputPath,
            derivationPath: produced.derivationPath,
          }),
        });
        return captured;
      },
    );
  });
  const stored = await storeFinalizedArtifactRunRecord({
    localTempRoot,
    outputRoot,
    workspaceRoot: context.workspaceRoot,
    artifactToolsRoot,
    observation: observed.observation,
    evidence: observed.result,
  });
  process.stdout.write(`${stored}\n`);
}

function required(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function onlyPath(stdout: string): string {
  const values = stdout.trim().split(/\s+/u).filter(Boolean);
  if (values.length !== 1 || !values[0]!.startsWith("/nix/store/")) {
    throw new Error("artifact build must produce exactly one Nix store path");
  }
  return values[0]!;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
