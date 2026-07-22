#!/usr/bin/env zx-wrapper
import fs from "node:fs/promises";
import path from "node:path";
import { enterCanonicalArtifactEntrypoint } from "../dev/canonical-artifact-entrypoint";
import { inspectWorkspaceArtifactSource } from "../dev/artifact-policy-inspection";
import { makeFilteredFlakeRef } from "../dev/filtered-flake";
import { withoutEvaluationSelectors } from "../dev/evaluation-bundle-env";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";
import { targetPackageFromLabel } from "../lib/artifact-source-inventory";
import { getFlagStr } from "../lib/cli";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import { runArtifactTool } from "./artifact-command";
import { resolveArtifactPublicationBinding } from "./artifact-reproducibility-publication-binding";
import { resolvePublicationSubjects } from "./publication-subject-authority";

const artifactToolsRoot = enterCanonicalArtifactEntrypoint();

async function main(): Promise<void> {
  if (!String(process.env.CI || "").trim()) throw new Error("publication bundle is CI-only");
  const workspaceRoot = process.cwd();
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  const graph = JSON.parse(await fs.readFile(graphPath, "utf8")) as unknown;
  const subjectId = required("subject-id");
  const subject = resolvePublicationSubjects(graph).find((entry) => entry.subjectId === subjectId);
  if (!subject) throw new Error(`current production graph does not authorize ${subjectId}`);
  const artifactEnv = buildCanonicalArtifactEnvironment(workspaceRoot, { artifactToolsRoot });
  const inventory = await inspectWorkspaceArtifactSource({
    workspaceRoot,
    targetPackages: [targetPackageFromLabel(subject.target)],
    env: artifactEnv,
  });
  if (inventory.localDevelopment) throw new Error("publication bundles reject local source inputs");
  const sourceRevision = (
    await runArtifactTool({
      tool: "git",
      args: ["rev-parse", "HEAD"],
      workspaceRoot,
      artifactToolsRoot,
    })
  ).stdout.trim();
  if (!/^[a-f0-9]{40,64}$/u.test(sourceRevision))
    throw new Error("publication source is not a commit");
  const bundle = await makeFilteredFlakeRef({
    workspaceRoot,
    attr: "graph-generator-selected",
    target: subject.target,
    graphPath,
    logPrefix: `[publication:${subject.subjectId}]`,
    classification: "hermetic",
    env: artifactEnv,
    selectorEnv: withoutEvaluationSelectors(process.env),
    sourceRevision,
  });
  const binding = await resolveArtifactPublicationBinding({
    subjectId,
    evaluationBundleRoot: bundle.bundlePath,
  });
  const outputRoot = path.resolve(required("output-root"));
  await fs.mkdir(outputRoot, { recursive: false, mode: 0o700 });
  await fs.writeFile(
    path.join(outputRoot, "bundle.json"),
    `${JSON.stringify(
      {
        schema: "viberoots.artifact-reproducibility-publication-bundle.v1",
        bundleSourceRoot: path.join(bundle.bundlePath, "source"),
        bundleDigest: bundle.bundleDigest,
        sourceRevision,
        binding,
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o444 },
  );
}

function required(name: string): string {
  const value = getFlagStr(name, "").trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
