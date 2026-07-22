import assert from "node:assert/strict";
import { test } from "node:test";
import { produceArtifactReproducibilityEvidence } from "../../ci/artifact-reproducibility-producer";
import { artifactToolClosureDigest } from "../../lib/artifact-reproducibility-evidence";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  reproducibilityRecipeDigest,
} from "../../lib/artifact-reproducibility-matrix";

const out = `/nix/store/${"b".repeat(32)}-artifact`;
const drv = `/nix/store/${"a".repeat(32)}-artifact.drv`;
const digest = (value: string) => `sha256:${value.repeat(64)}`;

function fixtureRunner(opts: { warmOutput?: string; warmNarHash?: string } = {}) {
  const calls: string[][] = [];
  let build = 0;
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "build") {
      build += 1;
      return { stdout: `${build === 2 && opts.warmOutput ? opts.warmOutput : out}\n` };
    }
    if (args.includes("--derivation")) return { stdout: `${drv}\n` };
    if (args.includes("--json")) {
      const narHash = build === 2 && opts.warmNarHash ? opts.warmNarHash : digest("6");
      return { stdout: JSON.stringify({ [out]: { narHash } }) };
    }
    return { stdout: "" };
  };
  return { calls, run };
}

const input = {
  evaluationBundleRoot: `/nix/store/${"c".repeat(32)}-bundle/source`,
  replayEvaluationBundleRoot: `/nix/store/${"c".repeat(32)}-bundle/source`,
  expectedEvaluationBundleDigest: digest("2"),
  expectedBindingDigest: digest("8"),
  system: "x86_64-linux",
  flakeRef: "path:/nix/store/bundle#artifact",
  outputPath: out,
  subjectAuthority: {
    kind: "matrix" as const,
    matrixDigest: ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
    matrixId: "node-artifact",
    artifactFamily: "node" as const,
    recipeDigest: reproducibilityRecipeDigest("node-artifact"),
    bindingDigest: digest("8"),
    target: "//projects/libs/repro-node:repro-node",
  },
  checkoutIdentity: digest("7"),
  builderAuthority: {
    identity: "reviewed:builder-one" as const,
    policy: "inherit_config" as const,
    supportedSystem: "x86_64-linux" as const,
    registryStorePath: `/nix/store/${"9".repeat(32)}-registry/registry.json`,
    policyAssertionStorePath: `/nix/store/${"c".repeat(32)}-builder-attestation`,
    probeFlakeStorePath: `/nix/store/${"8".repeat(32)}-builder-probes`,
  },
};
const identity = async (_root: string) => ({
  evaluationBundleDigest: digest("2"),
  sourceRevision: "a".repeat(40),
  immutableSourceDigest: digest("1"),
  declaredGraphDigest: digest("3"),
  dependencyLockDigest: digest("4"),
  toolClosureDigest: artifactToolClosureDigest(`/nix/store/${"f".repeat(32)}-remote-ci-tools`),
  toolClosureRoot: `/nix/store/${"f".repeat(32)}-remote-ci-tools`,
});

test("producer verifies, force-rebuilds, and checks a stable warm identity", async () => {
  const runner = fixtureRunner();
  const evidence = await produceArtifactReproducibilityEvidence(input, runner.run, {
    readIdentity: identity,
  });
  assert.equal(evidence.derivationPath, drv);
  assert.equal(evidence.narHash, digest("6"));
  assert.match(evidence.closureIdentityDigest, /^sha256:/u);
  assert.equal(evidence.forcedRebuild, true);
  assert.equal(evidence.warmIdentityStable, true);
  assert.equal(evidence.sourceRevision, "a".repeat(40));
  assert.equal(evidence.evaluationBundleAuthority.replayMaterializations, 2);
  assert.ok(runner.calls.some((args) => args.join(" ") === `store verify --no-trust ${out}`));
  assert.ok(runner.calls.some((args) => args.includes("--rebuild")));
});

test("producer rejects recursive closure drift after a forced rebuild", async () => {
  let recursive = 0;
  const runner = fixtureRunner();
  const run = async (args: string[]) => {
    const result = await runner.run(args);
    if (args.includes("--recursive")) {
      recursive += 1;
      return {
        stdout: JSON.stringify({
          [out]: { narHash: digest("6") },
          [`/nix/store/${"d".repeat(32)}-dependency`]: {
            narHash: recursive > 1 ? digest("9") : digest("8"),
          },
        }),
      };
    }
    return result;
  };
  await assert.rejects(
    produceArtifactReproducibilityEvidence(input, run, { readIdentity: identity }),
    /recursive closure identity/,
  );
});

test("producer rejects a replay that creates a second bundle identity", async () => {
  const runner = fixtureRunner();
  await assert.rejects(
    produceArtifactReproducibilityEvidence(
      {
        ...input,
        replayEvaluationBundleRoot: `/nix/store/${"d".repeat(32)}-bundle/source`,
      },
      runner.run,
      { readIdentity: identity },
    ),
    /replayed evaluation-bundle materialization changed/,
  );
});

test("producer fails when the warm build changes output identity", async () => {
  const runner = fixtureRunner({
    warmOutput: `/nix/store/${"d".repeat(32)}-different`,
  });
  await assert.rejects(
    produceArtifactReproducibilityEvidence(input, runner.run, { readIdentity: identity }),
    /warm build changed/,
  );
});
