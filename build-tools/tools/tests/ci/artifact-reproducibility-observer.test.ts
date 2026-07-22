import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  readVerifiedOwnedRootCleanupProof,
  verifyOwnedRootCleanupProof,
  writeVerifiedOwnedRootCleanupProof,
} from "../../ci/artifact-reproducibility-cleanup-proof";
import {
  classifyObservedRemoteStorePath,
  classifyOwnedStorePath,
} from "../../ci/artifact-reproducibility-observer";
import {
  ArtifactProcessLifecycle,
  storeProcessInspector,
} from "../../ci/artifact-reproducibility-process-evidence";
import { storeDelta } from "../../ci/artifact-reproducibility-store-observation";
import { assertArtifactReproducibilityObservation } from "../../lib/artifact-reproducibility-observation";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import {
  artifactReproducibilityEvidenceFixture,
  observationFixture,
} from "./artifact-reproducibility.fixture";

const store = (character: string, name: string) => `/nix/store/${character.repeat(32)}-${name}`;

test("owned cleanup proof is derived from and rechecks absent disk state", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "vbr-observation-proof-"));
  const ownedRoot = path.join(parent, "owned");
  const proofFile = path.join(parent, "proof.json");
  try {
    await fs.mkdir(ownedRoot);
    await fs.rm(ownedRoot, { recursive: true });
    await writeVerifiedOwnedRootCleanupProof(proofFile, ownedRoot);
    assert.equal(await verifyOwnedRootCleanupProof(proofFile), "verified");
    assert.deepEqual(await readVerifiedOwnedRootCleanupProof(proofFile), {
      status: "verified",
      ownedRoot,
    });
    await fs.mkdir(ownedRoot);
    await assert.rejects(() => verifyOwnedRootCleanupProof(proofFile), /does not match disk/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("remote store delta rejects paths outside the exact artifact authority", () => {
  const output = store("a", "output");
  const derivation = store("b", "output.drv");
  const dependency = store("c", "dependency");
  const authority = {
    closure: new Set([output, derivation, dependency]),
    derivations: new Set([derivation]),
  };
  assert.equal(classifyOwnedStorePath(output, [], output, authority), "artifact-output");
  assert.equal(classifyOwnedStorePath(dependency, [], output, authority), "dependency-closure");
  assert.throws(
    () => classifyOwnedStorePath(store("d", "foreign"), [], output, authority),
    /not owned by this artifact cell/,
  );
});

test("remote store observation attributes only pre/post smoke additions as builder probes", () => {
  const probe = store("e", "reviewed-builder-probe");
  const foreign = store("f", "foreign");
  const options = {
    remoteProbePaths: new Set([probe]),
    evaluationBundleRoots: [],
    outputPath: store("a", "output"),
    authority: { closure: new Set<string>(), derivations: new Set<string>() },
  };
  assert.equal(classifyObservedRemoteStorePath({ ...options, storePath: probe }), "builder-probe");
  assert.throws(
    () => classifyObservedRemoteStorePath({ ...options, storePath: foreign }),
    /not owned by this artifact cell/,
  );
});

test("matrix observation requires scaffold, both bundles, cleanup, and all build phases", () => {
  const observation = observationFixture(artifactReproducibilityEvidenceFixture());
  assert.doesNotThrow(() => assertArtifactReproducibilityObservation(observation));
  const incomplete = structuredClone(observation);
  incomplete.phases.splice(1, 1);
  assert.throws(
    () => assertArtifactReproducibilityObservation(incomplete),
    /exact subject-appropriate phase timing set/,
  );
});

test("publication observation requires only truthful subject phases", () => {
  const evidence = artifactReproducibilityEvidenceFixture({
    subjectAuthority: {
      kind: "publication",
      subjectSetDigest: `sha256:${"d".repeat(64)}`,
      subjectId: "static-webapp://projects/apps/example:app",
      target: "//projects/apps/example:app",
      deploymentComponents: ["//projects/deployments/example:deploy"],
      outputRole: "static-webapp",
    },
  });
  const observation = observationFixture(evidence);
  assert.deepEqual(
    observation.phases.map(({ phase }) => phase),
    [
      "evaluation-bundle-one",
      "evaluation-bundle-two",
      "initial-build",
      "forced-rebuild",
      "warm-build",
    ],
  );
  assert.doesNotThrow(() => assertArtifactReproducibilityObservation(observation));
  const fabricated = structuredClone(observation);
  fabricated.phases.unshift({ phase: "temp-consumer-scaffold", elapsedMs: 0 });
  assert.throws(
    () => assertArtifactReproducibilityObservation(fabricated),
    /exact subject-appropriate phase timing set/,
  );
  const legacy = { ...observation, schema: "viberoots.artifact-reproducibility-observation.v3" };
  assert.throws(
    () => assertArtifactReproducibilityObservation(legacy as never),
    /schema is invalid/,
  );
  const overstated = structuredClone(observation);
  overstated.finalizationBoundary.observationStoreRegistration = "observed" as never;
  assert.throws(
    () => assertArtifactReproducibilityObservation(overstated),
    /finalization boundary is invalid/,
  );
});

test("local store delta rejects a foreign path instead of attributing it", () => {
  const foreign = store("f", "foreign");
  assert.throws(
    () =>
      storeDelta(new Map(), new Map([[foreign, 10]]), (storePath) => {
        throw new Error(`foreign path: ${storePath}`);
      }),
    /foreign path/,
  );
});

test("managed process evidence rejects a surviving descendant group", async () => {
  const lifecycle = new ArtifactProcessLifecycle({
    inspectGroup: () => true,
    inspectProcesses: () => [],
  });
  lifecycle.started(4242);
  await assert.rejects(() => lifecycle.closed(4242), /left process group 4242 alive/);
  assert.throws(() => lifecycle.assertComplete(), /surviving or unclosed/);
});

test("managed process evidence rejects an observed descendant that escapes its group", async () => {
  let snapshot = [
    { pid: 4242, parentPid: 1, processGroupId: 4242 },
    { pid: 4243, parentPid: 4242, processGroupId: 4242 },
  ];
  const lifecycle = new ArtifactProcessLifecycle({
    inspectGroup: () => false,
    inspectProcesses: () => snapshot,
  });
  lifecycle.started(4242);
  snapshot = [{ pid: 4243, parentPid: 1, processGroupId: 4243 }];
  await assert.rejects(() => lifecycle.closed(4242), /descendant 4243 escaped process group 4242/);
});

test("managed process evidence retains enumerated descendant identities", async () => {
  let snapshot = [
    { pid: 5252, parentPid: 1, processGroupId: 5252 },
    { pid: 5253, parentPid: 5252, processGroupId: 5252 },
  ];
  const lifecycle = new ArtifactProcessLifecycle({
    inspectGroup: () => false,
    inspectProcesses: () => snapshot,
  });
  lifecycle.started(5252);
  snapshot = [];
  await lifecycle.closed(5252);
  assert.deepEqual(lifecycle.assertComplete().processGroups, [
    {
      leaderPid: 5252,
      processGroupId: 5252,
      descendantInspection: "verified",
      observedDescendantPids: [5253],
      descendantsClosed: true,
    },
  ]);
});

test("process evidence tool receives only its declared canonical environment", () => {
  const prior = process.env.HOSTILE_PROCESS_EVIDENCE_VALUE;
  process.env.HOSTILE_PROCESS_EVIDENCE_VALUE = "ambient";
  try {
    let childEnv: NodeJS.ProcessEnv | undefined;
    const inspect = storeProcessInspector(
      { PATH: "/nix/store/ps-tools/bin", HOME: "/owned/home" },
      {
        resolve: () => `/nix/store/${"a".repeat(32)}-procps/bin/ps`,
        run: (_executable, _args, env) => {
          childEnv = env;
          return "5252 1 5252\n";
        },
      },
    );
    assert.deepEqual(inspect(), [{ pid: 5252, parentPid: 1, processGroupId: 5252 }]);
    assert.equal(childEnv?.HOSTILE_PROCESS_EVIDENCE_VALUE, undefined);
    assert.equal(childEnv?.LC_ALL, "C.UTF-8");
    assert.equal(childEnv?.HOME, "/owned/home");
  } finally {
    if (prior === undefined) delete process.env.HOSTILE_PROCESS_EVIDENCE_VALUE;
    else process.env.HOSTILE_PROCESS_EVIDENCE_VALUE = prior;
  }
});

test("disk evidence tools receive the declared canonical environment", async () => {
  const [baseline, observer] = await Promise.all([
    fs.readFile(
      viberootsSourcePath("build-tools/tools/ci/artifact-reproducibility-cell-baseline.ts"),
      "utf8",
    ),
    fs.readFile(
      viberootsSourcePath("build-tools/tools/ci/artifact-reproducibility-observer.ts"),
      "utf8",
    ),
  ]);
  assert.match(baseline, /readSnapshotStats\(opts\.localTempRoot, opts\.evidenceToolEnv\)/u);
  assert.match(observer, /readSnapshotStats\(opts\.localTempRoot, opts\.evidenceToolEnv\)/u);
  assert.doesNotMatch(`${baseline}\n${observer}`, /readSnapshotStats\([^\n]+process\.env/u);
});
