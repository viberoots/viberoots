#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveDeploymentReviewedTargetEnvironment } from "../../deployments/deployment-reviewed-target-environment";
import { runInTemp } from "../lib/test-helpers";
import { installKubernetesTargets, kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { writeServiceArtifact } from "./kubernetes.service-artifact.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostAdmissionPolicyFixture,
} from "./nixos-shared-host.fixture";

async function gitStdout(cwd: string, $: any, ...args: string[]): Promise<string> {
  return String((await $({ cwd, stdio: "pipe" })`git ${args}`).stdout).trim();
}

async function commitLocalChange(cwd: string, $: any, name: string): Promise<string> {
  await fsp.writeFile(path.join(cwd, `${name}.txt`), `${name}\n`, "utf8");
  await $({ cwd, stdio: "pipe" })`git add ${`${name}.txt`}`;
  await $({ cwd, stdio: "pipe" })`git commit -m ${name}`;
  return await gitStdout(cwd, $, "rev-parse", "HEAD");
}

async function writeValues(root: string, deploymentId: string) {
  const configPath = path.join(
    root,
    "projects",
    "deployments",
    deploymentId,
    "helm",
    "values.yaml",
  );
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(
    configPath,
    "chart: ./charts/api\nsmoke_url: http://shared-observability.example.test/healthz\nsmoke_expect_contains: api\n",
    "utf8",
  );
}

test("service-backed kubernetes deploy fails closed when client source differs from service ref", async () => {
  await runInTemp("kubernetes-reviewed-source-mismatch", async (tmp, $) => {
    const baseLanePolicy = kubernetesDeploymentFixture().lanePolicy;
    const deployment = kubernetesDeploymentFixture({
      lanePolicy: {
        ...baseLanePolicy,
        sourceRefPolicy: {
          ...baseLanePolicy.sourceRefPolicy,
          prod: "main",
        },
        governance: {
          ...baseLanePolicy.governance,
          sourceRefPolicies: baseLanePolicy.governance.sourceRefPolicies.map((policy) =>
            policy.stage === "prod"
              ? {
                  ...policy,
                  allowedRefs: ["main"],
                  requiredChecks: ["deploy/shared-observability-prod"],
                }
              : policy,
          ),
          requiredApprovalBoundaries: [{ stage: "staging", requiredApprovals: ["release-owner"] }],
        },
      },
      admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
        ref: "//projects/deployments/sample-webapp/shared:prod_release",
        name: "prod_release",
        allowedRefs: ["main"],
        requiredChecks: ["deploy/shared-observability-prod"],
        requiredApprovals: [],
        fingerprint: "sha256:admission-platform-prod",
      }),
    });
    const artifactDir = path.join(tmp, "artifact");
    await writeServiceArtifact(artifactDir, "source-mismatch\n");
    await installKubernetesTargets(tmp, [deployment]);
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment as any);
    await writeValues(tmp, deployment.deploymentId);
    const serviceRevision = await gitStdout(tmp, $, "rev-parse", "HEAD");
    const clientRevision = await commitLocalChange(tmp, $, "client-drift");
    assert.notEqual(clientRevision, serviceRevision);
    await assert.rejects(
      resolveDeploymentReviewedTargetEnvironment({
        workspaceRoot: tmp,
        deployment,
        expectedSourceRevision: clientRevision,
        reviewedSourceSnapshot: {
          reviewedRef: "main",
          snapshotRef: "refs/vbr/reviewed-source/test/main",
          sourceRevision: serviceRevision,
          remoteName: "origin",
          repository: deployment.lanePolicy.governance.repository,
          snapshottedAt: "2026-04-06T12:00:00.000Z",
        },
      }),
      new RegExp(
        [
          "reviewed source mismatch for main",
          `clientExpectedSourceRevision=${clientRevision}`,
          `serviceReviewedSourceRevision=${serviceRevision}`,
          "service fetched the reviewed deployment source ref before admission",
          "that source ref is up to date and pushed before retrying",
        ].join("[\\s\\S]*"),
      ),
    );
  });
});
