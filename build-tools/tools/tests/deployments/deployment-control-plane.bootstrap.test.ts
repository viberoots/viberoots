#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { grantsFor } from "../../deployments/deployment-control-plane-authz.ts";
import {
  reconcileNixosSharedHostBootstrapRecord,
  runNixosSharedHostBootstrapDeploy,
} from "../../deployments/nixos-shared-host-bootstrap.ts";
import { runInTemp } from "../lib/test-helpers.ts";
import {
  bootstrapArtifacts,
  bootstrapDeploymentFixture,
} from "./deployment-control-plane.bootstrap.helpers.ts";
import {
  ensureNixosSharedHostStageBranch,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture.ts";
import { startNixosSharedHostPublicServer } from "./nixos-shared-host.public-server.ts";

test("bootstrap rejects non-bootstrap targets, ordinary authority, and missing proofs", async () => {
  await runInTemp("deployment-control-plane-bootstrap-rejections", async (tmp) => {
    const deployment = bootstrapDeploymentFixture();
    const artifacts = await bootstrapArtifacts(tmp, deployment);
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
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
          { role: "submitter", scope: { kind: "deployment_id", value: deployment.deploymentId } },
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
  });
});

test("bootstrap first install deploy records pending reconciliation", async () => {
  await runInTemp("deployment-control-plane-bootstrap-first-install", async (tmp, $) => {
    const deployment = bootstrapDeploymentFixture();
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const { componentArtifacts, compositeArtifactIdentity } = await bootstrapArtifacts(
      tmp,
      deployment,
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
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
});

test("offline recovery bootstrap reconciles evidence back into authoritative records", async () => {
  await runInTemp("deployment-control-plane-bootstrap-recovery", async (tmp, $) => {
    const deployment = bootstrapDeploymentFixture();
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const { componentArtifacts, compositeArtifactIdentity } = await bootstrapArtifacts(
      tmp,
      deployment,
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
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
  });
});

test("bootstrap first install is rejected after reconciliation hands back to the normal control plane", async () => {
  await runInTemp("deployment-control-plane-bootstrap-routine-rejected", async (tmp, $) => {
    const deployment = bootstrapDeploymentFixture();
    const paths = {
      statePath: path.join(tmp, "platform-state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot: path.join(tmp, "records"),
    };
    const { componentArtifacts, compositeArtifactIdentity } = await bootstrapArtifacts(
      tmp,
      deployment,
    );
    await ensureNixosSharedHostStageBranch(tmp, $, deployment);
    const server = await startNixosSharedHostPublicServer({ deployment, hostRoot: paths.hostRoot });
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
  });
});
