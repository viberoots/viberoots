#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { submitKubernetesDeploy } from "../../deployments/kubernetes-deploy.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture.ts";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture.ts";
import { ensureNixosSharedHostStageBranch } from "./nixos-shared-host.fixture.ts";

async function writeArtifact(root: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "service.txt"), "drift\n", "utf8");
}

test("kubernetes rejects provider config drift before publish begins", async () => {
  await runInTemp("kubernetes-config-drift", async (tmp, $) => {
    const deployment = kubernetesDeploymentFixture();
    const artifactDir = path.join(tmp, "artifact");
    await writeArtifact(artifactDir);
    await ensureNixosSharedHostStageBranch(tmp, $, deployment as any);
    const admissionEvidence = deploymentAdmissionEvidenceFixture({
      deployment,
      operationKind: "deploy",
      sourceRevision: "rev-kubernetes-config-drift-1",
      artifactIdentity: "artifact-kubernetes-config-drift-1",
      artifactLineageId: "artifact-kubernetes-config-drift-1",
    });
    const configPath = path.join(
      tmp,
      "test-workspace",
      "deployments",
      deployment.deploymentId,
      "helm",
      "values.yaml",
    );
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(
      configPath,
      ["chart: ./charts/api", "cluster: prod-eu-central", ""].join("\n"),
      "utf8",
    );
    await assert.rejects(
      async () =>
        await submitKubernetesDeploy({
          workspaceRoot: tmp,
          deployment,
          artifactDir,
          recordsRoot: path.join(tmp, "records"),
          admissionEvidence,
        }),
      /does not match deployment provider_target\.cluster/,
    );
  });
});
