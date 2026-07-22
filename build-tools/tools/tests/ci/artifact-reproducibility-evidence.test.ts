import assert from "node:assert/strict";
import { test } from "node:test";
import { assertArtifactReproducibilityEvidence } from "../../lib/artifact-reproducibility-evidence";
import { artifactReproducibilityEvidenceFixture } from "./artifact-reproducibility.fixture";

test("evidence v4 requires one exact builder and subject authority", () => {
  const evidence = artifactReproducibilityEvidenceFixture();
  assert.doesNotThrow(() => assertArtifactReproducibilityEvidence(evidence));
  assert.throws(
    () =>
      assertArtifactReproducibilityEvidence({
        ...evidence,
        builderAuthority: { ...evidence.builderAuthority, supportedSystem: "aarch64-linux" },
      }),
    /system does not match/,
  );
  assert.throws(
    () =>
      assertArtifactReproducibilityEvidence({
        ...evidence,
        builderAuthority: { ...evidence.builderAuthority, policy: "local" as never },
      }),
    /policy is invalid/,
  );
  assert.throws(
    () =>
      assertArtifactReproducibilityEvidence({
        ...evidence,
        builderAuthority: {
          ...evidence.builderAuthority,
          registryStorePath: `/nix/store/${"9".repeat(32)}-registry`,
        },
      }),
    /registryStorePath is not exact/,
  );
  assert.throws(
    () =>
      assertArtifactReproducibilityEvidence({
        ...evidence,
        builderIdentity: evidence.builderAuthority.identity,
      } as never),
    /invalid fields/,
  );
});

test("evidence v4 requires one replay-proven evaluation-bundle authority", () => {
  const evidence = artifactReproducibilityEvidenceFixture();
  assert.throws(
    () =>
      assertArtifactReproducibilityEvidence({
        ...evidence,
        evaluationBundleAuthority: {
          ...evidence.evaluationBundleAuthority,
          replayMaterializations: 1 as 2,
        },
      }),
    /two identical evaluation-bundle materializations/,
  );
  assert.throws(
    () =>
      assertArtifactReproducibilityEvidence({
        ...evidence,
        evaluationBundleDigest: evidence.evaluationBundleAuthority.digest,
      } as never),
    /invalid fields/,
  );
});
