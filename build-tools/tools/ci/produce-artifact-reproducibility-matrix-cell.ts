#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { enterCanonicalArtifactEntrypoint } from "../dev/canonical-artifact-entrypoint";
import { getFlagStr } from "../lib/cli";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  RELEASE_BUILDER_SYSTEMS,
} from "../lib/artifact-reproducibility-matrix";
import {
  assertReleaseRemoteBuilderCoverage,
  parseReviewedRemoteBuilders,
} from "../remote-exec/remote-builder-authority";
import { runArtifactNix, runArtifactTool } from "./artifact-command";
import { beginArtifactCellObservation } from "./artifact-reproducibility-cell-baseline";
import { withArtifactReproducibilityTempConsumer } from "./artifact-reproducibility-temp-consumer";
import { producePublicationCellRecords } from "./artifact-reproducibility-publication-cell";
import { copyArtifactPathsToEvidenceStore } from "./evidence-store-write-transport";
import { verifyRemoteCiToolsSourceIdentity } from "./remote-ci-tools-source-identity";
import { resolveArtifactRevisionDomains } from "./artifact-revision-domains";
import {
  matrixCellRecordFiles as recordAndObservation,
  matrixCellScript as script,
  matrixCellStorePath as onlyStorePath,
} from "./artifact-reproducibility-matrix-cell-files";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint();

async function main(): Promise<void> {
  if (!String(process.env.CI || "").trim()) {
    throw new Error("reproducibility matrix production is a protected CI-only entrypoint");
  }
  const workspaceRoot = process.cwd();
  const remoteCiTools = required("remote-ci-tools");
  const { toolSourceRevision } = await resolveArtifactRevisionDomains({
    workspaceRoot,
    artifactToolsRoot,
  });
  await verifyRemoteCiToolsSourceIdentity({
    remoteCiTools,
    expectedToolSourceRevision: toolSourceRevision,
    runNix: async (args) => await runArtifactNix({ args, workspaceRoot, artifactToolsRoot }),
  });
  const evidenceToolEnv = buildCanonicalArtifactEnvironment(workspaceRoot, { artifactToolsRoot });
  const system = required("system");
  if (!RELEASE_BUILDER_SYSTEMS.includes(system as never)) {
    throw new Error(`unsupported reproducibility matrix system: ${system}`);
  }
  const slot = required("builder-slot");
  if (slot !== "one" && slot !== "two") throw new Error("builder slot must be one or two");
  const registryStorePath = required("registry");
  const registry = parseReviewedRemoteBuilders(
    JSON.parse(await fs.readFile(registryStorePath, "utf8")),
  );
  assertReleaseRemoteBuilderCoverage(registry);
  const candidates = registry.builders.filter((builder) => builder.supportedSystem === system);
  if (candidates.length !== 2) {
    throw new Error(`reviewed registry requires two builders for ${system}`);
  }
  const builder = candidates[slot === "one" ? 0 : 1]!;
  const transportRoot = path.resolve(required("transport-root"));
  const transportFile = path.join(
    transportRoot,
    system,
    `${builder.identity.slice("reviewed:".length)}.json`,
  );
  const evidenceStore = registry.evidenceStore.storeUri;
  const outputRoot = path.resolve(required("output-root"));
  await fs.mkdir(outputRoot, { recursive: false, mode: 0o700 });
  const records: string[] = [];
  const observations: string[] = [];
  for (const matrixCase of ARTIFACT_REPRODUCIBILITY_MATRIX) {
    if (!matrixCase.systems.includes(system)) continue;
    const caseRoot = path.join(outputRoot, matrixCase.id);
    await fs.mkdir(caseRoot, { mode: 0o700 });
    const baseline = await beginArtifactCellObservation({
      localTempRoot: caseRoot,
      profile: "matrix-consumer",
      evidenceToolEnv,
      runLocalNix: async (args) => await runArtifactNix({ args, workspaceRoot, artifactToolsRoot }),
    });
    const prepared = await baseline.observe(
      async () =>
        await withArtifactReproducibilityTempConsumer({
          matrixId: matrixCase.id,
          ownerRoot: outputRoot,
          artifactToolsRoot,
          cleanupProofFile: path.join(caseRoot, "owned-root-cleanup.json"),
          onPhase: baseline.record,
          operation: async (tempWorkspaceRoot, tempSourceRevision) => {
            const context = { workspaceRoot: tempWorkspaceRoot, artifactToolsRoot };
            const bundleOutputs = [
              path.join(caseRoot, "bundle-one"),
              path.join(caseRoot, "bundle-two"),
            ];
            for (const [index, bundleOutput] of bundleOutputs.entries()) {
              await baseline.phase(
                index === 0 ? "evaluation-bundle-one" : "evaluation-bundle-two",
                async () =>
                  await runArtifactTool({
                    ...context,
                    tool: "zx-wrapper",
                    args: [
                      script(artifactToolsRoot, "prepare-artifact-reproducibility-bundle.ts"),
                      "--matrix-id",
                      matrixCase.id,
                      "--output-root",
                      bundleOutput,
                    ],
                  }),
              );
            }
            const [bundle, replayBundle] = await Promise.all(
              bundleOutputs.map(
                async (bundleOutput) =>
                  JSON.parse(await fs.readFile(path.join(bundleOutput, "bundle.json"), "utf8")) as {
                    bundleSourceRoot?: unknown;
                    bundleDigest?: unknown;
                    sourceRevision?: unknown;
                    binding?: { bindingDigest?: unknown };
                  },
              ),
            );
            if (
              String(bundle.bundleSourceRoot || "") !==
                String(replayBundle.bundleSourceRoot || "") ||
              String(bundle.bundleDigest || "") !== String(replayBundle.bundleDigest || "") ||
              String(bundle.sourceRevision || "") !== String(replayBundle.sourceRevision || "") ||
              String(bundle.binding?.bindingDigest || "") !==
                String(replayBundle.binding?.bindingDigest || "")
            ) {
              throw new Error(
                `unchanged replay created a new source, bundle, revision, or binding identity: ${matrixCase.id}`,
              );
            }
            if (String(bundle.sourceRevision || "") !== tempSourceRevision) {
              throw new Error(
                `temp consumer bundle revision does not match its deterministic commit: ${matrixCase.id}`,
              );
            }
            return { bundle, replayBundle };
          },
        }),
    );
    const cellObservationInput = path.join(caseRoot, "cell-observation-input.json");
    await baseline.write(cellObservationInput, "verified");
    const production = await runArtifactTool({
      workspaceRoot,
      artifactToolsRoot,
      tool: "zx-wrapper",
      args: [
        script(artifactToolsRoot, "produce-artifact-reproducibility-evidence.ts"),
        "--bundle-source-root",
        String(prepared.bundle.bundleSourceRoot || ""),
        "--replay-bundle-source-root",
        String(prepared.replayBundle.bundleSourceRoot || ""),
        "--bundle-digest",
        String(prepared.bundle.bundleDigest || ""),
        "--binding-digest",
        String(prepared.bundle.binding?.bindingDigest || ""),
        "--matrix-id",
        matrixCase.id,
        "--system",
        system,
        "--builder-policy",
        required("builder-policy"),
        "--remote-ci-tools",
        remoteCiTools,
        "--transport-file",
        transportFile,
        "--builder-identity",
        builder.identity,
        "--reviewed-builders",
        registryStorePath,
        "--probe-flake",
        builder.probeFlakeStorePath,
        "--evidence-store-aws-credentials-file",
        required("evidence-store-aws-credentials-file"),
        "--owned-root-cleanup-proof",
        path.join(caseRoot, "owned-root-cleanup.json"),
        "--cell-observation-input",
        cellObservationInput,
        "--output-root",
        path.join(caseRoot, "record"),
      ],
    });
    const record = await recordAndObservation(onlyStorePath(production.stdout));
    records.push(record.recordPath);
    observations.push(record.observationPath);
  }
  const publication = await producePublicationCellRecords({
    workspaceRoot,
    artifactToolsRoot,
    outputRoot,
    system,
    builderPolicy: required("builder-policy"),
    remoteCiTools,
    transportFile,
    registryStorePath,
    builder,
    evidenceStoreAwsCredentialsFile: required("evidence-store-aws-credentials-file"),
  });
  records.push(...publication.records);
  observations.push(...publication.observations);
  await copyArtifactPathsToEvidenceStore({
    workspaceRoot,
    artifactToolsRoot,
    awsSharedCredentialsFile: required("evidence-store-aws-credentials-file"),
    storeUri: evidenceStore,
    storePaths: [...records, ...observations].map((file) => path.dirname(file)),
  });
  await fs.writeFile(path.join(outputRoot, "records.txt"), `${records.join("\n")}\n`, {
    flag: "wx",
    mode: 0o444,
  });
  await fs.writeFile(path.join(outputRoot, "observations.txt"), `${observations.join("\n")}\n`, {
    flag: "wx",
    mode: 0o444,
  });
}

function required(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
