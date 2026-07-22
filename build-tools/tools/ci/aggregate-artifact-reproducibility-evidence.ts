#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { enterCanonicalArtifactEntrypoint } from "../dev/canonical-artifact-entrypoint";
import { getFlagStr } from "../lib/cli";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX,
  RELEASE_BUILDER_SYSTEMS,
} from "../lib/artifact-reproducibility-matrix";
import {
  aggregateArtifactReproducibilityEvidence,
  type ArtifactReproducibilityRunRecord,
} from "./artifact-reproducibility-aggregate";
import { runArtifactNix, runArtifactTool } from "./artifact-command";
import {
  canonicalJson,
  assertReleaseRemoteBuilderCoverage,
  parseReviewedRemoteBuilders,
} from "../remote-exec/remote-builder-authority";
import {
  signAndVerifyProtectedStore,
  signAndVerifyProtectedStoreClosure,
  verifyProtectedStoreSignature,
} from "../lib/protected-store-signature";
import { resolvePublicationSubjects } from "./publication-subject-authority";
import { copyArtifactPathsToEvidenceStore } from "./evidence-store-write-transport";
import type { ArtifactReproducibilityObservation } from "../lib/artifact-reproducibility-observation";
import {
  assertCanonicalStoreRootLayout,
  assertHydratedArtifactOutputIdentities,
  proveSignedEvidenceStoreReadback,
  protectedArtifactOutputIdentities,
  unsignedEvidenceIngressArgs,
} from "./artifact-reproducibility-protected-handoff";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint();

async function main(): Promise<void> {
  const registryStorePath = required("registry");
  assertStoreFile(registryStorePath, "reviewed registry");
  const runNix = async (args: string[]) =>
    await runArtifactNix({
      args,
      workspaceRoot: process.cwd(),
      artifactToolsRoot,
    });
  await verifyProtectedStoreSignature(registryStorePath, runNix);
  const registryText = await fs.readFile(registryStorePath, "utf8");
  const registry = parseReviewedRemoteBuilders(JSON.parse(registryText));
  assertReleaseRemoteBuilderCoverage(registry);
  if (registryText !== canonicalJson(registry)) {
    throw new Error("reproducibility aggregate requires the canonical signed registry");
  }
  const recordsRoot = path.resolve(required("records-root"));
  const outputRoot = path.resolve(required("output-root"));
  const recordFiles = await readCellManifests(recordsRoot, "records.txt");
  const observationFiles = await readCellManifests(recordsRoot, "observations.txt");
  const productionGraphPath = onlyStorePath(
    (await runNix(["store", "add-file", required("production-graph")])).stdout,
  );
  assertStoreFile(productionGraphPath, "production graph");
  const publicationSubjects = resolvePublicationSubjects(await readJson(productionGraphPath));
  const expectedRecords =
    (ARTIFACT_REPRODUCIBILITY_MATRIX.length + publicationSubjects.length) *
    RELEASE_BUILDER_SYSTEMS.length *
    2;
  if (recordFiles.length !== expectedRecords || new Set(recordFiles).size !== expectedRecords) {
    throw new Error(`aggregate input manifests require ${expectedRecords} unique run records`);
  }
  if (
    observationFiles.length !== expectedRecords ||
    new Set(observationFiles).size !== expectedRecords
  ) {
    throw new Error(`aggregate input manifests require ${expectedRecords} unique observations`);
  }
  const evidenceStore = registry.evidenceStore.storeUri;
  const recordRoots = recordFiles.map((file) => path.dirname(file));
  const observationRoots = observationFiles.map((file) => path.dirname(file));
  await runNix(unsignedEvidenceIngressArgs(evidenceStore, [...recordRoots, ...observationRoots]));
  const records = await Promise.all(
    recordFiles.map(async (file) => {
      assertStoreFile(file, "reproducibility run record");
      if (!file.endsWith("/run-record.json")) {
        throw new Error("reproducibility inputs must be canonical run-record.json files");
      }
      await assertCanonicalStoreRootLayout(file, "run-record.json");
      return (await readJson(file)) as ArtifactReproducibilityRunRecord;
    }),
  );
  const observations = await Promise.all(
    observationFiles.map(async (storePath) => {
      assertStoreFile(storePath, "reproducibility observation");
      await assertCanonicalStoreRootLayout(storePath, "run-observation.json");
      return {
        storePath,
        observation: (await readJson(storePath)) as ArtifactReproducibilityObservation,
      };
    }),
  );
  const expectedSourceRevision = (
    await runArtifactTool({
      tool: "git",
      args: ["rev-parse", "HEAD"],
      workspaceRoot: process.cwd(),
      artifactToolsRoot,
    })
  ).stdout.trim();
  const aggregate = aggregateArtifactReproducibilityEvidence({
    registry,
    registryStorePath,
    publicationSubjects,
    records,
    observations,
    languageManifest: await readJson(
      path.join(artifactToolsRoot, "share/viberoots-source/build-tools/tools/nix/langs.json"),
    ),
    expectedSourceRevision,
    expectedToolClosureRoot: artifactToolsRoot,
  });
  const outputIdentities = protectedArtifactOutputIdentities(records);
  await runNix(
    unsignedEvidenceIngressArgs(
      evidenceStore,
      outputIdentities.map(({ outputPath }) => outputPath),
    ),
  );
  await assertHydratedArtifactOutputIdentities(outputIdentities, runNix);
  const signingKeyFile = required("signing-key-file");
  await Promise.all(
    [...recordRoots, ...observationRoots].map(
      async (root) => await signAndVerifyProtectedStore(root, signingKeyFile, runNix),
    ),
  );
  await Promise.all(
    outputIdentities.map(
      async ({ outputPath }) =>
        await signAndVerifyProtectedStoreClosure(outputPath, signingKeyFile, runNix),
    ),
  );
  const protectedRoots = [
    ...recordRoots,
    ...observationRoots,
    ...outputIdentities.map(({ outputPath }) => outputPath),
  ];
  const awsSharedCredentialsFile = required("evidence-store-aws-credentials-file");
  await copyArtifactPathsToEvidenceStore({
    workspaceRoot: process.cwd(),
    artifactToolsRoot,
    awsSharedCredentialsFile,
    storeUri: evidenceStore,
    storePaths: protectedRoots,
  });
  await fs.mkdir(outputRoot, { recursive: false, mode: 0o700 });
  await fs.writeFile(
    path.join(outputRoot, "aggregate.json"),
    `${JSON.stringify(aggregate, null, 2)}\n`,
    { flag: "wx", mode: 0o444 },
  );
  await fs.writeFile(
    path.join(outputRoot, "observation-summary.json"),
    `${JSON.stringify(aggregate.observationSummary, null, 2)}\n`,
    { flag: "wx", mode: 0o444 },
  );
  const stored = await runArtifactNix({
    args: [
      "store",
      "add-path",
      "--name",
      "viberoots-artifact-reproducibility-aggregate-v3",
      outputRoot,
    ],
    workspaceRoot: process.cwd(),
    artifactToolsRoot,
  });
  const aggregateStorePath = stored.stdout.trim();
  await signAndVerifyProtectedStore(aggregateStorePath, signingKeyFile, runNix);
  await copyArtifactPathsToEvidenceStore({
    workspaceRoot: process.cwd(),
    artifactToolsRoot,
    awsSharedCredentialsFile,
    storeUri: evidenceStore,
    storePaths: [aggregateStorePath],
  });
  await proveSignedEvidenceStoreReadback({
    evidenceStore,
    roots: [...protectedRoots, aggregateStorePath],
    tempParent: path.dirname(recordsRoot),
    runNix,
  });
  process.stdout.write(
    `${JSON.stringify({
      aggregate: path.join(aggregateStorePath, "aggregate.json"),
      observationSummary: path.join(aggregateStorePath, "observation-summary.json"),
    })}\n`,
  );
}

async function readCellManifests(root: string, name: string): Promise<string[]> {
  return (
    await Promise.all(
      RELEASE_BUILDER_SYSTEMS.flatMap((system) =>
        ["one", "two"].map(async (slot) =>
          (await fs.readFile(path.join(root, `cell-${system}-${slot}`, name), "utf8"))
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean),
        ),
      ),
    )
  ).flat();
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function assertStoreFile(value: string, name: string): void {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+(?:\/[^/]+)?$/u.test(value)) {
    throw new Error(`${name} must be an immutable store path`);
  }
}

function onlyStorePath(value: string): string {
  const paths = value.trim().split(/\s+/u).filter(Boolean);
  if (paths.length !== 1 || !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(paths[0]!)) {
    throw new Error("production graph materialization must return one immutable store path");
  }
  return paths[0]!;
}

function required(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
