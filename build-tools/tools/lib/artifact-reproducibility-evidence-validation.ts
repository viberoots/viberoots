import {
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  assertReproducibilityMatrixBinding,
  reproducibilityMatrixCase,
  reproducibilityRecipeDigest,
} from "./artifact-reproducibility-matrix";
import type { ArtifactReproducibilityEvidence } from "./artifact-reproducibility-evidence";

const HASH = /^sha256[-:][A-Za-z0-9+/=_-]+$/u;
const STORE_PATH = /^\/nix\/store\/[a-z0-9]{32}-[^/]+$/u;
const REVISION = /^[a-f0-9]{40,64}$/u;
const EVIDENCE_KEYS = [
  "builderAuthority",
  "checkoutIdentity",
  "classification",
  "closureIdentityDigest",
  "declaredGraphDigest",
  "dependencyLockDigest",
  "derivationPath",
  "evaluationBundleAuthority",
  "forcedRebuild",
  "immutableSourceDigest",
  "narHash",
  "outputPath",
  "schema",
  "sourceRevision",
  "system",
  "subjectAuthority",
  "toolClosureDigest",
  "toolClosureRoot",
  "warmIdentityStable",
] as const;

export function assertArtifactReproducibilityEvidence(
  value: ArtifactReproducibilityEvidence,
): void {
  if (value?.schema !== "viberoots.artifact-reproducibility-evidence.v4") {
    throw new Error("artifact reproducibility evidence schema is invalid");
  }
  exactKeys(value, EVIDENCE_KEYS);
  if (value.classification !== "hermetic") throw new Error("artifact evidence is not hermetic");
  if (!REVISION.test(value.sourceRevision))
    throw new Error("source revision is not a git revision");
  for (const key of [
    "immutableSourceDigest",
    "declaredGraphDigest",
    "dependencyLockDigest",
    "toolClosureDigest",
    "narHash",
    "closureIdentityDigest",
  ] as const) {
    if (!HASH.test(value[key])) throw new Error(`artifact evidence ${key} is invalid`);
  }
  const bundle = value.evaluationBundleAuthority;
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("artifact evidence requires one evaluationBundleAuthority object");
  }
  exactKeys(bundle, ["bindingDigest", "digest", "replayMaterializations", "sourceRoot"]);
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/source$/u.test(bundle.sourceRoot)) {
    throw new Error("artifact evidence evaluation-bundle sourceRoot is not immutable");
  }
  if (!HASH.test(bundle.digest) || !HASH.test(bundle.bindingDigest)) {
    throw new Error("artifact evidence evaluation-bundle digest authority is invalid");
  }
  if (bundle.replayMaterializations !== 2) {
    throw new Error("artifact evidence requires two identical evaluation-bundle materializations");
  }
  for (const key of ["derivationPath", "outputPath"] as const) {
    if (!STORE_PATH.test(value[key]))
      throw new Error(`artifact evidence ${key} is not a store path`);
  }
  if (!STORE_PATH.test(value.toolClosureRoot)) {
    throw new Error("artifact evidence toolClosureRoot is not immutable");
  }
  for (const key of ["system", "checkoutIdentity"] as const) {
    required(key, value[key]);
  }
  const authority = value.builderAuthority;
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
    throw new Error("artifact evidence requires a builderAuthority object");
  }
  exactKeys(authority, [
    "identity",
    "policy",
    "policyAssertionStorePath",
    "probeFlakeStorePath",
    "registryStorePath",
    "supportedSystem",
  ]);
  if (!/^reviewed:[a-z0-9][a-z0-9._-]*$/u.test(authority.identity)) {
    throw new Error("artifact evidence builder authority identity is not reviewed");
  }
  if (!["inherit_config", "force_builders_file"].includes(authority.policy)) {
    throw new Error("artifact evidence builder authority policy is invalid");
  }
  if (authority.supportedSystem !== value.system) {
    throw new Error("artifact evidence builder authority system does not match the artifact");
  }
  if (!/^\/nix\/store\/[a-z0-9]{32}-[^/]+\/registry\.json$/u.test(authority.registryStorePath)) {
    throw new Error("artifact evidence builder authority registryStorePath is not exact");
  }
  for (const [name, storePath] of [
    ["policyAssertionStorePath", authority.policyAssertionStorePath],
    ["probeFlakeStorePath", authority.probeFlakeStorePath],
  ] as const) {
    if (!STORE_PATH.test(storePath)) {
      throw new Error(`artifact evidence builder authority ${name} is not immutable`);
    }
  }
  if (value.forcedRebuild !== true || value.warmIdentityStable !== true) {
    throw new Error("artifact evidence requires successful forced-rebuild and warm identity proof");
  }
  assertSubjectAuthority(value);
}

function assertSubjectAuthority(value: ArtifactReproducibilityEvidence): void {
  const subject = value.subjectAuthority;
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
    throw new Error("artifact evidence requires one subjectAuthority object");
  }
  if (subject.kind === "matrix") {
    exactKeys(subject, [
      "artifactFamily",
      "bindingDigest",
      "kind",
      "matrixDigest",
      "matrixId",
      "recipeDigest",
      "target",
    ]);
    for (const key of ["bindingDigest", "matrixDigest", "recipeDigest"] as const) {
      if (!HASH.test(subject[key])) throw new Error(`matrix subject ${key} is invalid`);
    }
    if (
      subject.matrixDigest !== ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST ||
      subject.recipeDigest !== reproducibilityRecipeDigest(subject.matrixId) ||
      subject.bindingDigest !== value.evaluationBundleAuthority.bindingDigest ||
      subject.target !== reproducibilityMatrixCase(subject.matrixId).graphSelection.target
    ) {
      throw new Error("matrix subject does not match its recipe, matrix, or bundle binding");
    }
    required("subjectAuthority.target", subject.target);
    assertReproducibilityMatrixBinding({ ...subject, system: value.system });
    return;
  }
  if (subject.kind !== "publication") throw new Error("artifact subject kind is invalid");
  exactKeys(subject, [
    "deploymentComponents",
    "kind",
    "outputRole",
    "subjectId",
    "subjectSetDigest",
    "target",
  ]);
  if (!HASH.test(subject.subjectSetDigest)) {
    throw new Error("publication subject set digest is invalid");
  }
  for (const key of ["outputRole", "subjectId", "target"] as const) required(key, subject[key]);
  if (
    !Array.isArray(subject.deploymentComponents) ||
    !subject.deploymentComponents.length ||
    subject.deploymentComponents.some((component) => !String(component).startsWith("//")) ||
    new Set(subject.deploymentComponents).size !== subject.deploymentComponents.length ||
    [...subject.deploymentComponents].sort().join("\0") !== subject.deploymentComponents.join("\0")
  ) {
    throw new Error("publication subject components must be a non-empty canonical target set");
  }
}

function required(name: string, value: string): void {
  if (!String(value || "").trim()) throw new Error(`artifact evidence ${name} is required`);
}

function exactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`artifact evidence has invalid fields: ${actual.join(", ")}`);
  }
}
