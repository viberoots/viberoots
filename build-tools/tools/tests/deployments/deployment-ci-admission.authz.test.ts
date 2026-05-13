#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { runInTemp } from "../lib/test-helpers";
import { ensureNixosSharedHostReviewedSourceRef } from "./nixos-shared-host.fixture";
import { writeDemoArtifact } from "./nixos-shared-host.control-plane.helpers";
import {
  authRequiredDeployment,
  evidenceWithoutPrincipal,
  postSubmission,
  writeAuthSession,
} from "./nixos-shared-host.service-auth-boundary.helpers";

test("submitter-only sessions cannot submit CI admission evidence", async () => {
  await runInTemp("deployment-ci-admission-authz", async (tmp, $) => {
    const deployment = authRequiredDeployment();
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
    const subject = String(
      (await $({ cwd: tmp, stdio: "pipe" })`git rev-parse HEAD`).stdout,
    ).trim();
    const artifactDir = path.join(tmp, "artifact");
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    await writeDemoArtifact(artifactDir, "ci-authz");
    const controlPlane = await startNixosSharedHostControlPlaneServer({
      workspaceRoot: tmp,
      paths,
      backendDatabaseUrl: localHarnessControlPlaneDatabaseUrl(paths.recordsRoot),
      localFixture: true,
    });
    try {
      const response = await postSubmission(controlPlane.url, {
        schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
        submissionId: "ci-authz-submit",
        submittedAt: new Date().toISOString(),
        deployment,
        operationKind: "deploy",
        authSessionId: await writeAuthSession({
          recordsRoot: paths.recordsRoot,
          deployment,
          operationKind: "deploy",
          principalId: "oidc:submitter",
          role: "submitter",
        }),
        artifactDir,
        admissionEvidence: {
          ...evidenceWithoutPrincipal(deployment),
          ciSubmission: {
            system: "jenkins",
            sourceRevision: subject,
            builderIdentity: "jenkins:mini/main",
            artifactIdentity: "static-webapp:placeholder",
            artifactRef: "retained-artifact://jenkins/placeholder",
          },
        },
      });
      assert.equal(response.status, 403);
      assert.match(await response.text(), /admission_reporter/);
    } finally {
      await controlPlane.close();
    }
  });
});
