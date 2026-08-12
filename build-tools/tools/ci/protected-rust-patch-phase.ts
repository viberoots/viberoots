import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { makeFilteredFlakeRef } from "../dev/filtered-flake";
import { buildCanonicalArtifactEnvironment } from "../lib/artifact-environment";
import { ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST } from "../lib/artifact-reproducibility-matrix";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const";
import type { ActiveReviewedRemoteNix } from "../remote-exec/active-reviewed-remote-nix";
import { resolveArtifactReproducibilityMatrixBinding } from "./artifact-reproducibility-matrix-binding";
import { buildArtifactOutputPair } from "./artifact-reproducibility-output-selection";
import { readArtifactSemanticManifest } from "./artifact-reproducibility-semantic-manifest";
import type { ProtectedRustPatchCaseDefinition } from "./protected-rust-patch-case-definitions";

export type ProtectedRustPatchPhase = {
  derivationPaths: string[];
  outputPaths: string[];
  semanticDigest: string;
  behaviorDigest: string;
  behavior: string;
  graphDigest: string;
  graphBindingDigest: string;
  matrixDigest: string;
  evaluationBundleDigest: string;
  sourceTreeDigest: string;
  consumerCommit: string;
  consumerTree: string;
  patchDigest: string | null;
  reachableNodes: readonly { name: string; ruleType: string; kinds: readonly string[] }[];
  reachableNodesDigest: string;
};

type ExactNix = Pick<ActiveReviewedRemoteNix, "runNix">;

export async function realizeProtectedRustPatchPhase(
  active: ExactNix,
  definition: ProtectedRustPatchCaseDefinition,
  workspaceRoot: string,
  expectedBehavior: "42" | "43",
  opts: {
    artifactToolsRoot: string;
    consumerCommit: string;
    consumerTree: string;
    patchDigest: string | null;
  },
): Promise<ProtectedRustPatchPhase> {
  const bundle = await makeFilteredFlakeRef({
    workspaceRoot,
    attr: definition.matrixCase.graphSelection.attr,
    target: definition.matrixCase.graphSelection.target,
    graphPath: path.join(workspaceRoot, DEFAULT_GRAPH_PATH),
    logPrefix: `[protected-rust-patch:${definition.id}]`,
    classification: "hermetic",
    env: buildCanonicalArtifactEnvironment(workspaceRoot, {
      artifactToolsRoot: opts.artifactToolsRoot,
    }),
    selectorEnv: {},
    sourceRevision: opts.consumerTree,
  });
  const binding = await resolveArtifactReproducibilityMatrixBinding({
    matrixId: definition.id,
    evaluationBundleRoot: bundle.bundlePath,
  });
  const graphBytes = await fs.readFile(path.join(bundle.bundlePath, "graph.json"));
  const added = await active.runNix([
    "store",
    "add-path",
    "--name",
    "viberoots-evaluation-bundle",
    bundle.bundlePath,
  ]);
  await bundle.cleanup();
  const bundleStorePath = onlyStorePath(added.stdout, `${definition.id} evaluation bundle`);
  const sourceTreeDigest = (
    await active.runNix(["hash", "path", `${bundleStorePath}/source`])
  ).stdout.trim();
  if (!/^sha256-[A-Za-z0-9+/=]+$/u.test(sourceTreeDigest)) {
    throw new Error(`protected Rust patch source tree digest is invalid: ${definition.id}`);
  }
  const flakeRef = `path:${bundleStorePath}?dir=source/.viberoots/workspace#graph-generator-selected`;
  const subjectAuthority = {
    kind: "matrix",
    matrixId: definition.id,
    artifactFamily: "rust",
  } as const;
  const evaluated = await active.runNix([
    "eval",
    "--no-write-lock-file",
    "--raw",
    `${flakeRef}.drvPath`,
  ]);
  const { outputPath, provenanceOutputPath } = await buildArtifactOutputPair(
    flakeRef,
    subjectAuthority,
    active.runNix,
  );
  const outputPaths = [...new Set([outputPath, provenanceOutputPath])];
  const derivationPaths = [
    ...new Set(
      await Promise.all(
        outputPaths.map(async (output) =>
          onlyStorePath(
            (await active.runNix(["path-info", "--derivation", output])).stdout,
            `${definition.id} derivation`,
          ),
        ),
      ),
    ),
  ];
  if (derivationPaths.length !== 1 || derivationPaths[0] !== evaluated.stdout.trim()) {
    throw new Error(`protected Rust patch derivation query mismatch: ${definition.id}`);
  }
  const semantic = await readArtifactSemanticManifest(
    outputPath,
    subjectAuthority,
    async (file) => Buffer.from((await active.runNix(["store", "cat", file])).stdout),
    provenanceOutputPath,
  );
  if (semantic.kind === "not-applicable") {
    throw new Error(`protected Rust patch lacks a semantic manifest: ${definition.id}`);
  }
  const behaviorBytes = Buffer.from(
    (await active.runNix(["store", "cat", `${outputPath}/share/viberoots-rust/observed-behavior`]))
      .stdout,
  );
  const behavior = behaviorBytes.toString("utf8");
  if (behavior !== expectedBehavior) {
    throw new Error(
      `protected Rust patch observed ${JSON.stringify(behavior)}, expected ${expectedBehavior}: ${definition.id}`,
    );
  }
  return {
    derivationPaths,
    outputPaths,
    semanticDigest: semantic.digest,
    behaviorDigest: digest(behaviorBytes),
    behavior,
    graphDigest: digest(graphBytes),
    graphBindingDigest: binding.bindingDigest,
    matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
    evaluationBundleDigest: bundle.bundleDigest,
    sourceTreeDigest,
    consumerCommit: opts.consumerCommit,
    consumerTree: opts.consumerTree,
    patchDigest: opts.patchDigest,
    reachableNodes: binding.reachableNodes,
    reachableNodesDigest: digest(Buffer.from(JSON.stringify(binding.reachableNodes))),
  };
}

function storePaths(stdout: string, label: string): string[] {
  const values = stdout.trim().split(/\s+/u).filter(Boolean);
  if (!values.length || values.some((value) => !/^\/nix\/store\/[a-z0-9]{32}-[^/]+/u.test(value))) {
    throw new Error(`protected Rust patch ${label} are not exact store paths`);
  }
  return values;
}

function onlyStorePath(stdout: string, label: string): string {
  const values = storePaths(stdout, label);
  if (values.length !== 1) throw new Error(`protected Rust patch ${label} is not one store path`);
  return values[0]!;
}

function digest(value: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
