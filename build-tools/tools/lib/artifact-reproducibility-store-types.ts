export type ArtifactStorePathRole =
  | "builder-probe"
  | "evaluation-bundle"
  | "artifact-output"
  | "derivation"
  | "dependency-closure";

export type ArtifactStoreDelta = {
  beforeCount: number;
  afterCount: number;
  newNarSize: number;
  newPaths: { path: string; narSize: number; role: ArtifactStorePathRole }[];
};
