import type { ProtectedRustPatchPhase } from "./protected-rust-patch-phase";

export function assertProtectedRustPatchLifecycle(
  caseId: string,
  baseline: ProtectedRustPatchPhase,
  patched: ProtectedRustPatchPhase,
  restored: ProtectedRustPatchPhase,
): void {
  const withoutCommit = ({ consumerCommit: _, ...phase }: ProtectedRustPatchPhase) => phase;
  const mismatches: string[] = [];
  const requireInvariant = (name: string, satisfied: boolean): void => {
    if (!satisfied) mismatches.push(name);
  };
  requireInvariant(
    "baseline-patched-commit-distinct",
    baseline.consumerCommit !== patched.consumerCommit,
  );
  requireInvariant(
    "patched-restored-commit-distinct",
    patched.consumerCommit !== restored.consumerCommit,
  );
  requireInvariant("baseline-restored-tree-equal", baseline.consumerTree === restored.consumerTree);
  requireInvariant(
    "baseline-patched-tree-distinct",
    baseline.consumerTree !== patched.consumerTree,
  );
  requireInvariant(
    "baseline-restored-evaluation-bundle-equal",
    baseline.evaluationBundleDigest === restored.evaluationBundleDigest,
  );
  requireInvariant(
    "baseline-patched-evaluation-bundle-distinct",
    baseline.evaluationBundleDigest !== patched.evaluationBundleDigest,
  );
  requireInvariant(
    "baseline-restored-source-tree-equal",
    baseline.sourceTreeDigest === restored.sourceTreeDigest,
  );
  requireInvariant("baseline-patch-absent", baseline.patchDigest === null);
  requireInvariant("patched-patch-present", !!patched.patchDigest);
  requireInvariant("restored-patch-absent", restored.patchDigest === null);
  requireInvariant("baseline-behavior-42", baseline.behavior === "42");
  requireInvariant("patched-behavior-43", patched.behavior === "43");
  requireInvariant(
    "pyodide-baseline-patched-behavior-distinct",
    baseline.pyodideBehaviorDigest === null ||
      baseline.pyodideBehaviorDigest !== patched.pyodideBehaviorDigest,
  );
  requireInvariant(
    "pyodide-abi-stable",
    baseline.pyodideAbiDigest === null ||
      (baseline.pyodideAbiDigest === patched.pyodideAbiDigest &&
        baseline.pyodideAbiDigest === restored.pyodideAbiDigest),
  );
  requireInvariant(
    "baseline-restored-phase-equal-except-commit",
    JSON.stringify(withoutCommit(baseline)) === JSON.stringify(withoutCommit(restored)),
  );
  if (mismatches.length === 0) return;

  const changedFields = Object.keys(withoutCommit(baseline)).filter(
    (field) =>
      JSON.stringify(withoutCommit(baseline)[field as keyof ReturnType<typeof withoutCommit>]) !==
      JSON.stringify(withoutCommit(restored)[field as keyof ReturnType<typeof withoutCommit>]),
  );
  throw new Error(
    [
      `protected Rust patch lifecycle mismatch: ${caseId}`,
      `failed invariants: ${mismatches.join(", ")}`,
      `baseline/restored changed fields: ${changedFields.join(", ") || "<none>"}`,
      `phases: ${JSON.stringify({ baseline, patched, restored })}`,
    ].join("\n"),
  );
}
