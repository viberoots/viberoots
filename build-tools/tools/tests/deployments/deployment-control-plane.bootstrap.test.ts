#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { grantsFor } from "../../deployments/deployment-control-plane-authz";
import {
  reconcileNixosSharedHostBootstrapRecord,
  runNixosSharedHostBootstrapDeploy,
} from "../../deployments/nixos-shared-host-bootstrap";
import { runInTemp } from "../lib/test-helpers";
import {
  bootstrapArtifacts,
  bootstrapCasePaths,
  bootstrapDeploymentFixture,
} from "./deployment-control-plane.bootstrap.helpers";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server";

test("deployment control-plane bootstrap flows", async (t) => {
  await runInTemp("deployment-control-plane-bootstrap", async (tmp, $) => {
    const deployment = bootstrapDeploymentFixture();
    await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);

    await t.test(
      "rejects non-bootstrap targets, ordinary authority, and missing proofs",
      async () => {
        const root = path.join(tmp, "rejections");
        const artifacts = await bootstrapArtifacts(root, deployment);
        const paths = bootstrapCasePaths(root);
        await assert.rejects(
          runNixosSharedHostBootstrapDeploy({
            deployment: nixosSharedHostDeploymentFixture(),
            ...artifacts,
            paths,
            authorization: grantsFor({ principalId: "user:bootstrap" }, [
              {
                role: "bootstrap",
                scope: { kind: "bootstrap_deployment", value: deployment.deploymentId },
              },
            ]),
            mode: "first_install",
            ownershipProof: "ops-owned",
            targetIdentityProof: deployment.providerTarget.deploymentTargetIdentity,
            executedBy: { principalId: "user:bootstrap" },
          }),
          /not deployment-system-owned infrastructure/,
        );
        await assert.rejects(
          runNixosSharedHostBootstrapDeploy({
            deployment,
            ...artifacts,
            paths,
            authorization: grantsFor({ principalId: "user:submitter" }, [
              {
                role: "submitter",
                scope: { kind: "deployment_id", value: deployment.deploymentId },
              },
            ]),
            mode: "first_install",
            ownershipProof: "ops-owned",
            targetIdentityProof: deployment.providerTarget.deploymentTargetIdentity,
            executedBy: { principalId: "user:bootstrap" },
          }),
          /not authorized for bootstrap/,
        );
        await assert.rejects(
          runNixosSharedHostBootstrapDeploy({
            deployment,
            ...artifacts,
            paths,
            authorization: grantsFor({ principalId: "user:bootstrap" }, [
              {
                role: "bootstrap",
                scope: { kind: "bootstrap_deployment", value: deployment.deploymentId },
              },
            ]),
            mode: "first_install",
            ownershipProof: "",
            targetIdentityProof: "nixos-shared-host:default:wrong",
            executedBy: { principalId: "user:bootstrap" },
          }),
          /explicit ownership proof|target identity proof mismatch/,
        );
      },
    );

    await t.test("first install deploy records pending reconciliation", async () => {
      const root = path.join(tmp, "first-install");
      const paths = bootstrapCasePaths(root);
      const { componentArtifacts, compositeArtifactIdentity } = await bootstrapArtifacts(
        root,
        deployment,
      );
      const server = await startNixosSharedHostPublicServer({
        deployment,
        hostRoot: paths.hostRoot,
      });
      try {
        const result = await runNixosSharedHostBootstrapDeploy({
          deployment,
          componentArtifacts,
          compositeArtifactIdentity,
          paths,
          authorization: grantsFor({ principalId: "user:bootstrap" }, [
            {
              role: "bootstrap",
              scope: { kind: "bootstrap_deployment", value: deployment.deploymentId },
            },
          ]),
          mode: "first_install",
          ownershipProof: "ops-owned",
          targetIdentityProof: deployment.providerTarget.deploymentTargetIdentity,
          executedBy: { principalId: "user:bootstrap" },
          smokeConnectOverride: {
            protocol: "https:",
            hostname: "127.0.0.1",
            port: server.port,
            rejectUnauthorized: false,
          },
        });
        assert.equal(result.record.bootstrap?.mode, "first_install");
        assert.equal(result.record.bootstrap?.reconciliation.status, "pending");
        assert.equal(result.record.artifact?.identity, compositeArtifactIdentity);
      } finally {
        await server.close();
      }
    });

    await t.test(
      "offline recovery reconciles evidence back into authoritative records",
      async () => {
        const root = path.join(tmp, "recovery");
        const paths = bootstrapCasePaths(root);
        const { componentArtifacts, compositeArtifactIdentity } = await bootstrapArtifacts(
          root,
          deployment,
        );
        const server = await startNixosSharedHostPublicServer({
          deployment,
          hostRoot: paths.hostRoot,
        });
        try {
          const result = await runNixosSharedHostBootstrapDeploy({
            deployment,
            componentArtifacts,
            compositeArtifactIdentity,
            paths,
            authorization: grantsFor({ principalId: "user:bootstrap" }, [
              {
                role: "bootstrap",
                scope: { kind: "bootstrap_deployment", value: deployment.deploymentId },
              },
            ]),
            mode: "offline_recovery",
            ownershipProof: "ops-owned",
            targetIdentityProof: deployment.providerTarget.deploymentTargetIdentity,
            executedBy: { principalId: "user:bootstrap" },
            smokeConnectOverride: {
              protocol: "https:",
              hostname: "127.0.0.1",
              port: server.port,
              rejectUnauthorized: false,
            },
          });
          const reconciled = await reconcileNixosSharedHostBootstrapRecord({
            recordsRoot: paths.recordsRoot,
            deployRunId: result.record.deployRunId,
            reconciledBy: { principalId: "user:control-plane" },
          });
          assert.equal(reconciled.record.bootstrap?.reconciliation.status, "ingested");
          await fsp.access(reconciled.reconciliationPath);
        } finally {
          await server.close();
        }
      },
    );

    await t.test(
      "first install is rejected after reconciliation hands back to the normal control plane",
      async () => {
        const root = path.join(tmp, "routine-rejected");
        const paths = bootstrapCasePaths(root);
        const { componentArtifacts, compositeArtifactIdentity } = await bootstrapArtifacts(
          root,
          deployment,
        );
        const server = await startNixosSharedHostPublicServer({
          deployment,
          hostRoot: paths.hostRoot,
        });
        try {
          const authorization = grantsFor({ principalId: "user:bootstrap" }, [
            {
              role: "bootstrap",
              scope: { kind: "bootstrap_deployment", value: deployment.deploymentId },
            },
          ]);
          const result = await runNixosSharedHostBootstrapDeploy({
            deployment,
            componentArtifacts,
            compositeArtifactIdentity,
            paths,
            authorization,
            mode: "first_install",
            ownershipProof: "ops-owned",
            targetIdentityProof: deployment.providerTarget.deploymentTargetIdentity,
            executedBy: { principalId: "user:bootstrap" },
            smokeConnectOverride: {
              protocol: "https:",
              hostname: "127.0.0.1",
              port: server.port,
              rejectUnauthorized: false,
            },
          });
          await reconcileNixosSharedHostBootstrapRecord({
            recordsRoot: paths.recordsRoot,
            deployRunId: result.record.deployRunId,
            reconciledBy: { principalId: "user:control-plane" },
          });
          await assert.rejects(
            runNixosSharedHostBootstrapDeploy({
              deployment,
              componentArtifacts,
              compositeArtifactIdentity,
              paths,
              authorization,
              mode: "first_install",
              ownershipProof: "ops-owned",
              targetIdentityProof: deployment.providerTarget.deploymentTargetIdentity,
              executedBy: { principalId: "user:bootstrap" },
              smokeConnectOverride: {
                protocol: "https:",
                hostname: "127.0.0.1",
                port: server.port,
                rejectUnauthorized: false,
              },
            }),
            /use the normal control plane for routine updates/,
          );
        } finally {
          await server.close();
        }
      },
    );
  });
});
