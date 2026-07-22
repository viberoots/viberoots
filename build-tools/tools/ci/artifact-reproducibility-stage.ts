export async function runArtifactReproducibilityStage(opts: {
  stage: string;
  runTool: (script: string, args?: string[]) => Promise<void>;
  toolPath: (relative: string) => string;
  flag: (name: string, fallback: string) => string;
}): Promise<boolean> {
  const passFlags = (names: readonly string[]): string[] =>
    names.flatMap((name) => {
      const value = opts.flag(name, "").trim();
      if (!value) throw new Error(`--${name} is required for ${opts.stage}`);
      return [`--${name}`, value];
    });
  if (opts.stage === "reproducibility-matrix-cell") {
    await opts.runTool(
      opts.toolPath("tools/ci/produce-artifact-reproducibility-matrix-cell.ts"),
      passFlags([
        "system",
        "builder-slot",
        "registry",
        "transport-root",
        "remote-ci-tools",
        "builder-policy",
        "evidence-store-aws-credentials-file",
        "output-root",
      ]),
    );
    return true;
  }
  if (opts.stage === "reproducibility-aggregate") {
    await opts.runTool(
      opts.toolPath("tools/ci/aggregate-artifact-reproducibility-evidence.ts"),
      passFlags([
        "registry",
        "records-root",
        "production-graph",
        "signing-key-file",
        "evidence-store-aws-credentials-file",
        "output-root",
      ]),
    );
    return true;
  }
  return false;
}
