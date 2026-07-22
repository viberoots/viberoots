import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";
import type { ReviewedRemoteBuilderRegistry } from "../remote-exec/remote-builder-authority";
import { runArtifactNix, runArtifactTool } from "./artifact-command";
import { beginArtifactCellObservation } from "./artifact-reproducibility-cell-baseline";
import { resolvePublicationSubjects } from "./publication-subject-authority";

export async function producePublicationCellRecords(opts: {
  workspaceRoot: string;
  artifactToolsRoot: string;
  outputRoot: string;
  system: string;
  builderPolicy: string;
  remoteCiTools: string;
  transportFile: string;
  registryStorePath: string;
  evidenceStoreAwsCredentialsFile: string;
  builder: ReviewedRemoteBuilderRegistry["builders"][number];
}): Promise<{ records: string[]; observations: string[] }> {
  const graph = JSON.parse(
    await fs.readFile(path.join(opts.workspaceRoot, DEFAULT_GRAPH_PATH), "utf8"),
  ) as unknown;
  const subjects = resolvePublicationSubjects(graph);
  const records: string[] = [];
  const observations: string[] = [];
  const context = { workspaceRoot: opts.workspaceRoot, artifactToolsRoot: opts.artifactToolsRoot };
  const evidenceToolEnv = buildCanonicalArtifactEnvironment(opts.workspaceRoot, {
    artifactToolsRoot: opts.artifactToolsRoot,
  });
  for (const [index, subject] of subjects.entries()) {
    const subjectRoot = path.join(opts.outputRoot, `publication-${index}`);
    const bundleOutputs = [
      path.join(subjectRoot, "bundle-one"),
      path.join(subjectRoot, "bundle-two"),
    ];
    await fs.mkdir(subjectRoot, { mode: 0o700 });
    const baseline = await beginArtifactCellObservation({
      localTempRoot: subjectRoot,
      profile: "publication-subject",
      evidenceToolEnv,
      runLocalNix: async (args) => await runArtifactNix({ args, ...context }),
    });
    for (const [index, bundleOutput] of bundleOutputs.entries()) {
      await baseline.phase(
        index === 0 ? "evaluation-bundle-one" : "evaluation-bundle-two",
        async () =>
          await runArtifactTool({
            ...context,
            tool: "zx-wrapper",
            args: [
              script(
                opts.artifactToolsRoot,
                "prepare-artifact-reproducibility-publication-bundle.ts",
              ),
              "--subject-id",
              subject.subjectId,
              "--output-root",
              bundleOutput,
            ],
          }),
      );
    }
    const [bundle, replay] = await Promise.all(
      bundleOutputs.map(
        async (root) =>
          JSON.parse(await fs.readFile(path.join(root, "bundle.json"), "utf8")) as {
            bundleSourceRoot?: unknown;
            bundleDigest?: unknown;
            sourceRevision?: unknown;
            binding?: { bindingDigest?: unknown };
          },
      ),
    );
    if (
      String(bundle.bundleSourceRoot || "") !== String(replay.bundleSourceRoot || "") ||
      String(bundle.bundleDigest || "") !== String(replay.bundleDigest || "") ||
      String(bundle.sourceRevision || "") !== String(replay.sourceRevision || "") ||
      String(bundle.binding?.bindingDigest || "") !== String(replay.binding?.bindingDigest || "")
    )
      throw new Error(`publication replay changed immutable identity: ${subject.subjectId}`);
    const cellObservationInput = path.join(subjectRoot, "cell-observation-input.json");
    await baseline.write(cellObservationInput, "not-applicable");
    const production = await runArtifactTool({
      ...context,
      tool: "zx-wrapper",
      args: [
        script(opts.artifactToolsRoot, "produce-artifact-reproducibility-evidence.ts"),
        "--bundle-source-root",
        String(bundle.bundleSourceRoot || ""),
        "--replay-bundle-source-root",
        String(replay.bundleSourceRoot || ""),
        "--bundle-digest",
        String(bundle.bundleDigest || ""),
        "--binding-digest",
        String(bundle.binding?.bindingDigest || ""),
        "--publication-subject-id",
        subject.subjectId,
        "--system",
        opts.system,
        "--builder-policy",
        opts.builderPolicy,
        "--remote-ci-tools",
        opts.remoteCiTools,
        "--transport-file",
        opts.transportFile,
        "--builder-identity",
        opts.builder.identity,
        "--reviewed-builders",
        opts.registryStorePath,
        "--probe-flake",
        opts.builder.probeFlakeStorePath,
        "--evidence-store-aws-credentials-file",
        opts.evidenceStoreAwsCredentialsFile,
        "--cell-observation-input",
        cellObservationInput,
        "--output-root",
        path.join(subjectRoot, "record"),
      ],
    });
    const recordPath = path.join(onlyStorePath(production.stdout), "run-record.json");
    const record = JSON.parse(await fs.readFile(recordPath, "utf8")) as {
      observationStorePath?: unknown;
    };
    const observationPath = String(record.observationStorePath || "");
    if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/run-observation\.json$/u.test(observationPath)) {
      throw new Error("publication record omitted its immutable observation path");
    }
    records.push(recordPath);
    observations.push(observationPath);
  }
  return { observations, records };
}

function script(artifactToolsRoot: string, name: string): string {
  return path.join(artifactToolsRoot, "share/viberoots-source/build-tools/tools/ci", name);
}

function onlyStorePath(value: string): string {
  const paths = value.trim().split(/\s+/u).filter(Boolean);
  if (paths.length !== 1 || !/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(paths[0]!)) {
    throw new Error("publication producer must return one immutable record root");
  }
  return paths[0]!;
}
