#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertCrossDeploymentExactPromotionEligible } from "../../deployments/deployment-provider-promotion";
import {
  seedCurrentStageState,
  seedSyntheticTargetStageState,
} from "./nixos-shared-host.promotion.stage-state.helpers";
import {
  nixosSharedHostDeploymentFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { viberootsRepoPath } from "./deployment-command";

async function readDeploySource(relativePath: string): Promise<string> {
  return await fsp.readFile(
    viberootsRepoPath(path.join("build-tools/tools/deployments", relativePath)),
    "utf8",
  );
}

function sourceAndTarget() {
  const lanePolicy = nixosSharedHostLanePolicyFixture({
    allowedPromotionEdges: ["dev->staging"],
  });
  const source = nixosSharedHostDeploymentFixture({
    deploymentId: "provider-helper-dev",
    label: "//projects/deployments/provider-helper-dev:deploy",
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    environmentStage: "dev",
  });
  const target = nixosSharedHostDeploymentFixture({
    deploymentId: "provider-helper-staging",
    label: "//projects/deployments/provider-helper-staging:deploy",
    lanePolicyRef: lanePolicy.ref,
    lanePolicy,
    environmentStage: "staging",
  });
  return { source, target };
}

test("provider exact-artifact promotion requires current stage state", async () => {
  const { source, target } = sourceAndTarget();
  await assert.rejects(
    assertCrossDeploymentExactPromotionEligible({
      deployment: target,
      recordsRoot: "/tmp/provider-helper-records",
      source: {
        record: {
          deployRunId: "deploy-source",
          deploymentId: source.deploymentId,
          finalOutcome: "succeeded",
          publishMode: "normal",
        },
        artifactIdentity: "static-webapp:source",
        replaySnapshot: {
          artifactIdentity: "static-webapp:source",
          admittedContext: {
            lanePolicyFingerprint: source.lanePolicy.fingerprint,
            source: { sourceRevision: "source-revision" },
          },
          deployment: source,
        },
      },
    }),
    /promotion eligibility requires backendDatabaseUrl/,
  );
});

test("provider exact-artifact promotion reads artifact identity from replay snapshot", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "provider-promotion-stage-state-"));
  try {
    const { source, target } = sourceAndTarget();
    const recordsRoot = path.join(tmp, "records");
    const recordPath = path.join(recordsRoot, "runs", "deploy-source.json");
    await fsp.mkdir(path.dirname(recordPath), { recursive: true });
    await fsp.writeFile(
      recordPath,
      JSON.stringify({
        deployRunId: "deploy-source",
        operationKind: "deploy",
        publishMode: "normal",
        finalOutcome: "succeeded",
        deploymentId: source.deploymentId,
        deploymentLabel: source.label,
        provider: source.provider,
        providerTargetIdentity: source.providerTarget.sharedDevTargetIdentity,
        artifactIdentity: "static-webapp:source",
        admittedContext: {
          source: {
            sourceRef: "main",
            sourceRevision: "source-revision",
            artifactIdentity: "static-webapp:source",
          },
        },
      }) + "\n",
      "utf8",
    );
    const backendDatabaseUrl = await seedCurrentStageState({
      recordsRoot,
      recordPath,
      deployment: source,
    });
    await seedSyntheticTargetStageState({ recordsRoot, deployment: target });
    await assertCrossDeploymentExactPromotionEligible({
      deployment: target,
      recordsRoot,
      backendDatabaseUrl,
      source: {
        record: {
          deployRunId: "deploy-source",
          deploymentId: source.deploymentId,
          finalOutcome: "succeeded",
          publishMode: "normal",
        },
        replaySnapshot: {
          artifactIdentity: "static-webapp:source",
          admittedContext: {
            lanePolicyFingerprint: source.lanePolicy.fingerprint,
            source: { sourceRevision: "source-revision" },
          },
          deployment: source,
        },
      },
    });
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("provider exact-artifact promotion rejects stale target provider identity", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "provider-promotion-target-state-"));
  try {
    const { source, target } = sourceAndTarget();
    const recordsRoot = path.join(tmp, "records");
    const recordPath = path.join(recordsRoot, "runs", "deploy-source.json");
    await fsp.mkdir(path.dirname(recordPath), { recursive: true });
    await fsp.writeFile(
      recordPath,
      JSON.stringify({
        deployRunId: "deploy-source",
        operationKind: "deploy",
        publishMode: "normal",
        finalOutcome: "succeeded",
        deploymentId: source.deploymentId,
        deploymentLabel: source.label,
        provider: source.provider,
        providerTargetIdentity: source.providerTarget.sharedDevTargetIdentity,
        artifactIdentity: "static-webapp:source",
        admittedContext: {
          source: {
            sourceRef: "main",
            sourceRevision: "source-revision",
            artifactIdentity: "static-webapp:source",
          },
        },
      }) + "\n",
      "utf8",
    );
    const backendDatabaseUrl = await seedCurrentStageState({
      recordsRoot,
      recordPath,
      deployment: source,
    });
    await seedSyntheticTargetStageState({
      recordsRoot,
      deployment: {
        ...target,
        providerTarget: {
          ...target.providerTarget,
          sharedDevTargetIdentity: "nixos-shared-host:default:stale-target",
          deploymentTargetIdentity: "nixos-shared-host:default:stale-target",
        },
      },
    });
    await assert.rejects(
      assertCrossDeploymentExactPromotionEligible({
        deployment: target,
        recordsRoot,
        backendDatabaseUrl,
        source: {
          record: {
            deployRunId: "deploy-source",
            deploymentId: source.deploymentId,
            finalOutcome: "succeeded",
            publishMode: "normal",
          },
          replaySnapshot: {
            artifactIdentity: "static-webapp:source",
            admittedContext: {
              lanePolicyFingerprint: source.lanePolicy.fingerprint,
              source: { sourceRevision: "source-revision" },
            },
            deployment: source,
          },
        },
      }),
      /target stage state provider target identity mismatch/,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("provider front doors pass explicit backend database URL into promotion eligibility", async () => {
  const readonlySource = await readDeploySource("deploy-cli-readonly.ts");
  assert.match(readonlySource, /controlPlaneDatabaseUrl: getFlagStr\("control-plane-database-url"/);

  const dispatchSource = await readDeploySource("deploy-cli-provider-dispatch.ts");
  assert.match(
    dispatchSource,
    /runS3StaticDeployFrontDoor\(\{[\s\S]*backendDatabaseUrl: flags\.controlPlaneDatabaseUrl/,
  );
  assert.match(
    dispatchSource,
    /runKubernetesDeployFrontDoor\(\{[\s\S]*backendDatabaseUrl: flags\.controlPlaneDatabaseUrl/,
  );

  const kubernetesSource = await readDeploySource("kubernetes-front-door.ts");
  assert.match(kubernetesSource, /backendDatabaseUrl\?: string/);
  assert.match(
    kubernetesSource,
    /assertCrossDeploymentExactPromotionEligible\(\{[\s\S]*backendDatabaseUrl: opts\.backendDatabaseUrl/,
  );

  const s3Source = await readDeploySource("s3-static-front-door.ts");
  assert.match(s3Source, /backendDatabaseUrl\?: string/);
  assert.match(
    s3Source,
    /assertCrossDeploymentExactPromotionEligible\(\{[\s\S]*backendDatabaseUrl: opts\.backendDatabaseUrl/,
  );
});
