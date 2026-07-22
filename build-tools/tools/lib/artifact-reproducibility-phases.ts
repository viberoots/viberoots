export const ARTIFACT_OBSERVATION_BUILD_PHASES = [
  "initial-build",
  "forced-rebuild",
  "warm-build",
] as const;

const MATRIX_PRE_BUILD_PHASES = [
  "temp-consumer-scaffold",
  "evaluation-bundle-one",
  "evaluation-bundle-two",
  "owned-root-cleanup",
] as const;

const PUBLICATION_PRE_BUILD_PHASES = ["evaluation-bundle-one", "evaluation-bundle-two"] as const;

export type ArtifactObservationProfile = "matrix-consumer" | "publication-subject";

export type ArtifactObservationPhase =
  | (typeof MATRIX_PRE_BUILD_PHASES)[number]
  | (typeof ARTIFACT_OBSERVATION_BUILD_PHASES)[number];

export function observationPhases(profile: ArtifactObservationProfile): ArtifactObservationPhase[] {
  const preBuild =
    profile === "matrix-consumer" ? MATRIX_PRE_BUILD_PHASES : PUBLICATION_PRE_BUILD_PHASES;
  return [...preBuild, ...ARTIFACT_OBSERVATION_BUILD_PHASES];
}

export function isArtifactObservationProfile(value: unknown): value is ArtifactObservationProfile {
  return value === "matrix-consumer" || value === "publication-subject";
}
