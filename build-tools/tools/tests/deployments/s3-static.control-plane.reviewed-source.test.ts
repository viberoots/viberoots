#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import { startControlPlaneHarness } from "./nixos-shared-host.control-plane.helpers";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostAdmissionPolicyFixture,
} from "./nixos-shared-host.fixture";
import { installS3StaticTargets, s3StaticDeploymentFixture } from "./s3-static.fixture";

async function gitStdout(cwd: string, $: any, ...args: string[]): Promise<string> {
  return String((await $({ cwd, stdio: "pipe" })`git ${args}`).stdout).trim();
}

async function commitLocalChange(cwd: string, $: any, name: string): Promise<string> {
  await fsp.writeFile(path.join(cwd, `${name}.txt`), `${name}\n`, "utf8");
  await $({ cwd, stdio: "pipe" })`git add ${`${name}.txt`}`;
  await $({ cwd, stdio: "pipe" })`git commit -m ${name}`;
  return await gitStdout(cwd, $, "rev-parse", "HEAD");
}

async function writeArtifact(root: string) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), "<html>source-mismatch</html>\n", "utf8");
}

async function writeClientRevisionEvidence(opts: {
  tmp: string;
  $: any;
  deployment: ReturnType<typeof s3StaticDeploymentFixture>;
  clientRevision: string;
}): Promise<string> {
  const evidence = await writeReviewedLaneAdmissionEvidenceJson({
    tmp: opts.tmp,
    $: opts.$,
    deploymentLabel: opts.deployment.label,
    deployment: opts.deployment,
  });
  const value = JSON.parse(await fsp.readFile(evidence, "utf8"));
  value.checks = opts.deployment.admissionPolicy.requiredChecks.map((name) => ({
    name,
    subject: opts.clientRevision,
    status: "passed",
    checkedAt: "2026-04-06T12:00:00.000Z",
    deploymentId: opts.deployment.deploymentId,
    environmentStage: opts.deployment.environmentStage,
    admissionPolicyRef: opts.deployment.admissionPolicyRef,
    recordRef: `check://${name}`,
  }));
  await fsp.writeFile(evidence, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return evidence;
}

test("service-backed s3-static deploy fails closed when client source differs from service ref", async () => {
  await runInTemp("s3-static-reviewed-source-mismatch", async (tmp, $) => {
    const deployment = s3StaticDeploymentFixture({
      admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
        ref: "//projects/deployments/pleomino-shared:staging_release",
        name: "staging_release",
        allowedRefs: ["env/pleomino/staging"],
        requiredChecks: ["deploy/pleomino-staging-s3"],
        fingerprint: "sha256:admission-pleomino-s3-staging",
      }),
    });
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    await installS3StaticTargets(tmp, [deployment]);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    const serviceRevision = await gitStdout(tmp, $, "rev-parse", "env/pleomino/staging");
    const clientRevision = await commitLocalChange(tmp, $, "client-drift");
    assert.notEqual(clientRevision, serviceRevision);
    const evidence = await writeClientRevisionEvidence({
      tmp,
      $,
      deployment,
      clientRevision,
    });
    const harness = await startControlPlaneHarness({
      workspaceRoot: tmp,
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    });
    try {
      await assert.rejects(
        $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${deployment.label} --artifact-dir ${artifactDir} --admission-evidence-json ${evidence} --control-plane-url ${harness.controlPlane.url}`,
        new RegExp(
          [
            "reviewed source mismatch for env/pleomino/staging",
            `clientExpectedSourceRevision=${clientRevision}`,
            `serviceReviewedSourceRevision=${serviceRevision}`,
            "service fetched the reviewed deployment branch before admission",
            "that branch is up to date and pushed before retrying",
          ].join("[\\s\\S]*"),
        ),
      );
    } finally {
      await harness.close();
    }
  });
});
