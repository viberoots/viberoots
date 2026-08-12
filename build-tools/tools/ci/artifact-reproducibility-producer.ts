import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertArtifactReproducibilityEvidence,
  artifactToolClosureDigest,
  type ArtifactReproducibilityEvidence,
} from "../lib/artifact-reproducibility-evidence";
import {
  readArtifactSemanticManifest,
  readRemoteNixStoreFile,
} from "./artifact-reproducibility-semantic-manifest";
import { verifyArtifactOutputPair } from "./artifact-reproducibility-output-identity";
export { readArtifactPathIdentity } from "./artifact-reproducibility-output-identity";

type RunNix = (args: string[]) => Promise<{ stdout: string; stderr?: string }>;

export type ReproducibilityProductionInput = {
  evaluationBundleRoot: string;
  replayEvaluationBundleRoot: string;
  expectedEvaluationBundleDigest: string;
  expectedBindingDigest: string;
  system: string;
  flakeRef: string;
  outputPath: string;
  provenanceOutputPath: string;
  subjectAuthority: ArtifactReproducibilityEvidence["subjectAuthority"];
  checkoutIdentity: string;
  toolSourceRevision: string;
  builderAuthority: ArtifactReproducibilityEvidence["builderAuthority"];
};

export async function produceArtifactReproducibilityEvidence(
  input: ReproducibilityProductionInput,
  runNix: RunNix,
  deps: { readIdentity?: typeof readBundleIdentity } = {},
): Promise<ArtifactReproducibilityEvidence> {
  const identity = await (deps.readIdentity || readBundleIdentity)(input.evaluationBundleRoot);
  const replayIdentity = await (deps.readIdentity || readBundleIdentity)(
    input.replayEvaluationBundleRoot,
  );
  if (
    input.evaluationBundleRoot !== input.replayEvaluationBundleRoot ||
    canonicalJson(identity) !== canonicalJson(replayIdentity)
  ) {
    throw new Error("replayed evaluation-bundle materialization changed immutable identity");
  }
  if (identity.evaluationBundleDigest !== input.expectedEvaluationBundleDigest) {
    throw new Error("supplied evaluation-bundle digest does not match the immutable bundle");
  }
  const evaluationBundleAuthority: ArtifactReproducibilityEvidence["evaluationBundleAuthority"] = {
    sourceRoot: input.evaluationBundleRoot,
    digest: input.expectedEvaluationBundleDigest,
    bindingDigest: input.expectedBindingDigest,
    replayMaterializations: 2,
  };
  const { runtime: initial, provenance: initialProvenance } = await verifyArtifactOutputPair(
    input,
    runNix,
  );
  const semanticManifest = await readArtifactSemanticManifest(
    input.outputPath,
    input.subjectAuthority,
    async (storePath) => await readRemoteNixStoreFile(runNix, storePath),
    input.provenanceOutputPath,
  );
  const evidence: ArtifactReproducibilityEvidence = {
    schema: "viberoots.artifact-reproducibility-evidence.v6",
    classification: "hermetic",
    sourceRevision: identity.sourceRevision,
    toolSourceRevision: input.toolSourceRevision,
    immutableSourceDigest: identity.immutableSourceDigest,
    evaluationBundleAuthority,
    declaredGraphDigest: identity.declaredGraphDigest,
    dependencyLockDigest: identity.dependencyLockDigest,
    toolClosureDigest: identity.toolClosureDigest,
    toolClosureRoot: identity.toolClosureRoot,
    system: input.system,
    derivationPath: initial.derivationPath,
    outputPath: input.outputPath,
    provenanceOutputPath: input.provenanceOutputPath,
    narHash: initial.narHash,
    provenanceNarHash: initialProvenance.narHash,
    closureIdentityDigest: initial.closureIdentityDigest,
    provenanceClosureIdentityDigest: initialProvenance.closureIdentityDigest,
    semanticManifest,
    subjectAuthority: input.subjectAuthority,
    checkoutIdentity: input.checkoutIdentity,
    builderAuthority: input.builderAuthority,
    forcedRebuild: true,
    warmIdentityStable: true,
  };
  assertArtifactReproducibilityEvidence(evidence);
  return evidence;
}

export async function readBundleIdentity(sourceRoot: string) {
  if (!sourceRoot.startsWith("/nix/store/")) {
    throw new Error("reproducibility evidence requires an immutable evaluation-bundle source");
  }
  const bundleRoot = path.dirname(sourceRoot);
  const [manifest, graph, dependencies, schema, classification, sourceAuthorityText] =
    await Promise.all([
      readRequired(path.join(bundleRoot, "manifest.json")),
      readRequired(path.join(bundleRoot, "graph.json")),
      readRequired(path.join(bundleRoot, "dependency-inputs.json")),
      readRequired(path.join(bundleRoot, "schema.json")),
      readRequired(path.join(bundleRoot, "classification.json")),
      readRequired(path.join(bundleRoot, "source-authority.json")),
    ]);
  if ((JSON.parse(classification) as { classification?: unknown }).classification !== "hermetic") {
    throw new Error("reproducibility evidence rejects a non-hermetic evaluation bundle");
  }
  const parsedDependencies = JSON.parse(dependencies) as { artifactToolsRoot?: unknown };
  const toolsRoot = String(parsedDependencies.artifactToolsRoot || "");
  if (!toolsRoot.startsWith("/nix/store/")) {
    throw new Error("evaluation bundle lacks a store-qualified tool closure");
  }
  const evaluationBundleDigest = String((JSON.parse(schema) as { digest?: unknown }).digest || "");
  if (!evaluationBundleDigest.startsWith("sha256:")) {
    throw new Error("evaluation bundle schema lacks its canonical digest");
  }
  const sourceAuthority = JSON.parse(sourceAuthorityText) as Record<string, unknown>;
  if (
    Object.keys(sourceAuthority).sort().join(",") !== "schema,sourceRevision" ||
    sourceAuthority.schema !== "viberoots.evaluation-bundle-source-authority.v1" ||
    !/^[a-f0-9]{40,64}$/u.test(String(sourceAuthority.sourceRevision || ""))
  ) {
    throw new Error("evaluation bundle lacks canonical immutable source authority");
  }
  return {
    evaluationBundleDigest,
    sourceRevision: String(sourceAuthority.sourceRevision),
    immutableSourceDigest: digest(manifest),
    declaredGraphDigest: digest(graph),
    dependencyLockDigest: digest(dependencies),
    toolClosureDigest: artifactToolClosureDigest(toolsRoot),
    toolClosureRoot: toolsRoot,
  };
}

export function opaqueIdentity(value: string): string {
  if (!value.trim()) throw new Error("identity input is required");
  return digest(path.resolve(value));
}

async function readRequired(file: string): Promise<string> {
  return await fs.readFile(file, "utf8").catch(() => {
    throw new Error(`evaluation bundle identity input is missing: ${path.basename(file)}`);
  });
}

function digest(value: string): string {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
