import crypto from "node:crypto";
import { assertArtifactReproducibilityEvidence } from "./artifact-reproducibility-evidence-validation";
export { assertArtifactReproducibilityEvidence } from "./artifact-reproducibility-evidence-validation";

export type ArtifactBuilderAuthority = {
  identity: `reviewed:${string}`;
  policy: "inherit_config" | "force_builders_file";
  supportedSystem: "aarch64-darwin" | "aarch64-linux" | "x86_64-linux";
  registryStorePath: string;
  policyAssertionStorePath: string;
  probeFlakeStorePath: string;
};

export type ArtifactReproducibilitySubjectAuthority =
  | {
      kind: "matrix";
      matrixDigest: string;
      matrixId: string;
      artifactFamily: "go" | "node" | "python" | "cpp" | "wasm" | "mixed";
      recipeDigest: string;
      bindingDigest: string;
      target: string;
    }
  | {
      kind: "publication";
      subjectSetDigest: string;
      subjectId: string;
      target: string;
      deploymentComponents: readonly string[];
      outputRole: string;
    };

export type ArtifactReproducibilityEvidence = {
  schema: "viberoots.artifact-reproducibility-evidence.v4";
  classification: "hermetic";
  sourceRevision: string;
  immutableSourceDigest: string;
  evaluationBundleAuthority: {
    sourceRoot: string;
    digest: string;
    bindingDigest: string;
    replayMaterializations: 2;
  };
  declaredGraphDigest: string;
  dependencyLockDigest: string;
  toolClosureDigest: string;
  toolClosureRoot: string;
  system: string;
  derivationPath: string;
  outputPath: string;
  narHash: string;
  closureIdentityDigest: string;
  subjectAuthority: ArtifactReproducibilitySubjectAuthority;
  checkoutIdentity: string;
  builderAuthority: ArtifactBuilderAuthority;
  forcedRebuild: true;
  warmIdentityStable: true;
};

export function artifactIdentityFields(evidence: ArtifactReproducibilityEvidence) {
  const { checkoutIdentity: _checkout, builderAuthority: _builder, ...identity } = evidence;
  return identity;
}

export function artifactIdentityDigest(evidence: ArtifactReproducibilityEvidence): string {
  return `sha256:${crypto
    .createHash("sha256")
    .update(canonicalJson(artifactIdentityFields(evidence)))
    .digest("hex")}`;
}

export function artifactToolClosureDigest(toolClosureRoot: string): string {
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u.test(toolClosureRoot)) {
    throw new Error("artifact tool closure root is not immutable");
  }
  return `sha256:${crypto.createHash("sha256").update(toolClosureRoot).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
