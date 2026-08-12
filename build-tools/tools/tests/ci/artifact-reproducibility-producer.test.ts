import assert from "node:assert/strict";
import { test } from "node:test";
import { produceArtifactReproducibilityEvidence } from "../../ci/artifact-reproducibility-producer";
import { artifactToolClosureDigest } from "../../lib/artifact-reproducibility-evidence";
import {
  ARTIFACT_REPRODUCIBILITY_MATRIX_DIGEST,
  reproducibilityMatrixCase,
  reproducibilityRecipeDigest,
} from "../../lib/artifact-reproducibility-matrix";

const out = `/nix/store/${"b".repeat(32)}-artifact`;
const provenance = `/nix/store/${"d".repeat(32)}-artifact-provenance`;
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
  provenanceOutputPath: out,
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
  toolSourceRevision: "b".repeat(40),
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

test("producer reads Rust and Tauri semantics through the reviewed remote Nix runner", async () => {
  const cases = [
    {
      matrixId: "rust-lib-pr12",
      suffix: "share/viberoots-rust/materialization-manifest.json",
      manifest: {
        schemaVersion: "viberoots.nix-store-materialization.v1",
        storePaths: [{ path: out }],
      },
    },
    {
      matrixId: "rust-tauri-darwin-pr12",
      suffix: "share/viberoots-tauri/artifact-manifest.json",
      manifest: {
        schema: "viberoots.tauri-artifact.v1",
        signature: { releaseSigned: false, releaseAdmitted: false },
      },
    },
  ] as const;
  for (const entry of cases) {
    const matrixCase = reproducibilityMatrixCase(entry.matrixId);
    const system = matrixCase.systems[0] as "aarch64-darwin" | "aarch64-linux" | "x86_64-linux";
    const runner = fixtureRunner();
    const run = async (args: string[]) => {
      const result = await runner.run(args);
      if (args[0] === "store" && args[1] === "cat") {
        return { stdout: JSON.stringify(entry.manifest) };
      }
      return result;
    };
    await produceArtifactReproducibilityEvidence(
      {
        ...input,
        system,
        builderAuthority: {
          ...input.builderAuthority,
          supportedSystem: system,
        },
        subjectAuthority: {
          ...input.subjectAuthority,
          matrixId: entry.matrixId,
          artifactFamily: "rust",
          recipeDigest: reproducibilityRecipeDigest(entry.matrixId),
          target: matrixCase.graphSelection.target,
        },
      },
      run,
      { readIdentity: identity },
    );
    assert.ok(
      runner.calls.some(
        (args) => args.join(" ") === `store cat ${pathForSemanticManifest(entry.suffix)}`,
      ),
      entry.matrixId,
    );
  }
});

test("producer binds split Rust WASM runtime and provenance to one derivation", async () => {
  const matrixCase = reproducibilityMatrixCase("rust-wasm-pr12");
  const splitInput = {
    ...input,
    provenanceOutputPath: provenance,
    subjectAuthority: {
      ...input.subjectAuthority,
      matrixId: matrixCase.id,
      artifactFamily: "rust" as const,
      recipeDigest: reproducibilityRecipeDigest(matrixCase.id),
      target: matrixCase.graphSelection.target,
    },
  };
  const run = async (args: string[]) => {
    const selectedPath = args.includes(provenance) ? provenance : out;
    if (args[0] === "build") {
      return { stdout: `${args.at(-1)?.endsWith("^provenance") ? provenance : out}\n` };
    }
    if (args[0] === "store" && args[1] === "cat") {
      return {
        stdout: JSON.stringify({
          schemaVersion: "viberoots.nix-store-materialization.v1",
          storePaths: [{ path: out, provenancePath: provenance }],
        }),
      };
    }
    if (args.includes("--derivation")) return { stdout: `${drv}\n` };
    if (args.includes("--json")) {
      return { stdout: JSON.stringify({ [selectedPath]: { narHash: digest("6") } }) };
    }
    return { stdout: "" };
  };
  const evidence = await produceArtifactReproducibilityEvidence(splitInput, run, {
    readIdentity: identity,
  });
  assert.equal(evidence.outputPath, out);
  assert.equal(evidence.provenanceOutputPath, provenance);
  assert.equal(evidence.provenanceNarHash, digest("6"));
  assert.equal(
    evidence.semanticManifest.kind === "rust-materialization-manifest"
      ? evidence.semanticManifest.storePath
      : "",
    `${provenance}/share/viberoots-rust/materialization-manifest.json`,
  );
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

function pathForSemanticManifest(suffix: string): string {
  return `${out}/${suffix}`;
}
