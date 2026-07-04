#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { grantsFor } from "../../deployments/deployment-control-plane-authz";
import { submitCloudflarePagesTargetTransition } from "../../deployments/cloudflare-pages-target-transition";
import { runInTemp } from "../lib/test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { deploymentTargetExceptionFixture } from "./deployment-metadata.fixture";

function approvalEvidence(recordRef: string, deploymentId: string, targetIdentity: string) {
  return {
    approvals: [
      {
        name: "target-transition",
        approvalId: "target-transition-approval",
        status: "approved" as const,
        approver: { principalId: "user:reviewer" },
        grantedAt: "2026-04-08T12:00:00.000Z",
        payloadFingerprint: "target-transition",
        deploymentId,
        targetIdentity,
        recordRef,
      },
    ],
  };
}

test("target transition records retirement and migration with reviewed exception metadata", async () => {
  await runInTemp("cloudflare-pages-target-transition-success", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const retirement = deploymentTargetExceptionFixture({
      ref: "//projects/deployments/sample-webapp/staging:retire_window",
      affectedDeploymentIds: ["sample-webapp-staging"],
      oldProviderTargetIdentity:
        "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
      approvalEvidence: "approval://retire-window",
    });
    const retiredDeployment = cloudflarePagesDeploymentFixture({
      targetExceptions: [retirement],
    });
    const retired = await submitCloudflarePagesTargetTransition({
      deployment: retiredDeployment,
      recordsRoot,
      operationKind: "retire_target",
      targetExceptionRef: retirement.ref,
      admissionEvidence: approvalEvidence(
        retirement.approvalEvidence,
        retiredDeployment.deploymentId,
        retiredDeployment.providerTarget.providerTargetIdentity,
      ),
    });
    assert.equal(retired.record.oldProviderTargetIdentity, retirement.oldProviderTargetIdentity);
    assert.equal(retired.record.resultingOwnershipState.kind, "retired");
    const migration = deploymentTargetExceptionFixture({
      ref: "//projects/deployments/sample-webapp/next-staging:migrate_window",
      exceptionKind: "migration",
      affectedDeploymentIds: ["sample-webapp-staging", "sample-webapp-next-staging"],
      oldProviderTargetIdentity:
        "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
      newProviderTargetIdentity: "cloudflare-pages:web-platform-staging/sample-webapp-next-pages",
      sharedLockScope: "cloudflare-pages:web-platform-staging/sample-webapp-transition-window",
      approvalEvidence: "approval://migrate-window",
    });
    const migratedDeployment = cloudflarePagesDeploymentFixture({
      deploymentId: "sample-webapp-next-staging",
      label: "//projects/deployments/sample-webapp/next-staging:deploy",
      providerTarget: {
        ...cloudflarePagesDeploymentFixture().providerTarget,
        project: "sample-webapp-next-pages",
        id: "sample-webapp-next-pages",
        providerTargetIdentity: "cloudflare-pages:web-platform-staging/sample-webapp-next-pages",
        canonicalUrl: "https://sample-webapp-next-pages.pages.dev/",
      },
      targetExceptions: [migration],
    });
    const migrated = await submitCloudflarePagesTargetTransition({
      deployment: migratedDeployment,
      recordsRoot,
      operationKind: "migrate_target",
      targetExceptionRef: migration.ref,
      admissionEvidence: approvalEvidence(
        migration.approvalEvidence,
        migratedDeployment.deploymentId,
        migratedDeployment.providerTarget.providerTargetIdentity,
      ),
    });
    assert.equal(migrated.record.sharedLockScope, migration.sharedLockScope);
    assert.equal(migrated.record.newProviderTargetIdentity, migration.newProviderTargetIdentity);
    assert.deepEqual(migrated.record.resultingOwnershipState, {
      kind: "migrated",
      ownerDeploymentId: migratedDeployment.deploymentId,
      providerTargetIdentity: migratedDeployment.providerTarget.providerTargetIdentity,
    });
  });
});

test("target transition fails closed for missing, expired, or superseded exceptions", async () => {
  await runInTemp("cloudflare-pages-target-transition-fail-closed", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const expired = deploymentTargetExceptionFixture({
      ref: "//projects/deployments/sample-webapp/staging:expired_window",
      affectedDeploymentIds: ["sample-webapp-staging"],
      approvalEvidence: "approval://expired",
      effectiveAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
    });
    const superseded = deploymentTargetExceptionFixture({
      ref: "//projects/deployments/sample-webapp/staging:alias_window_old",
      affectedDeploymentIds: ["sample-webapp-staging"],
      approvalEvidence: "approval://old",
      effectiveAt: "2026-01-01T00:00:00.000Z",
    });
    const newer = deploymentTargetExceptionFixture({
      ref: "//projects/deployments/sample-webapp/staging:alias_window_new",
      affectedDeploymentIds: ["sample-webapp-staging"],
      approvalEvidence: "approval://new",
      effectiveAt: "2026-03-01T00:00:00.000Z",
    });
    const deployment = cloudflarePagesDeploymentFixture({
      targetExceptions: [expired, superseded, newer],
    });
    await assert.rejects(
      async () =>
        await submitCloudflarePagesTargetTransition({
          deployment,
          recordsRoot,
          operationKind: "retire_target",
          targetExceptionRef: "//projects/deployments/sample-webapp/staging:missing",
          admissionEvidence: approvalEvidence(
            "approval://missing",
            deployment.deploymentId,
            deployment.providerTarget.providerTargetIdentity,
          ),
        }),
      /target exception not found/,
    );
    await assert.rejects(
      async () =>
        await submitCloudflarePagesTargetTransition({
          deployment,
          recordsRoot,
          operationKind: "retire_target",
          targetExceptionRef: expired.ref,
          admissionEvidence: approvalEvidence(
            expired.approvalEvidence,
            deployment.deploymentId,
            deployment.providerTarget.providerTargetIdentity,
          ),
        }),
      /not active/,
    );
    await assert.rejects(
      async () =>
        await submitCloudflarePagesTargetTransition({
          deployment,
          recordsRoot,
          operationKind: "retire_target",
          targetExceptionRef: superseded.ref,
          admissionEvidence: approvalEvidence(
            superseded.approvalEvidence,
            deployment.deploymentId,
            deployment.providerTarget.providerTargetIdentity,
          ),
        }),
      /superseded/,
    );
  });
});

test("target transition requires operator authorization and reviewed approval evidence", async () => {
  await runInTemp("cloudflare-pages-target-transition-authz", async (tmp) => {
    const recordsRoot = path.join(tmp, "records");
    const exception = deploymentTargetExceptionFixture({
      ref: "//projects/deployments/sample-webapp/staging:retire_window",
      affectedDeploymentIds: ["sample-webapp-staging"],
      oldProviderTargetIdentity:
        "cloudflare-pages:web-platform-staging/sample-webapp-staging-pages",
      approvalEvidence: "approval://transition-ticket",
    });
    const deployment = cloudflarePagesDeploymentFixture({
      targetExceptions: [exception],
    });
    await assert.rejects(
      async () =>
        await submitCloudflarePagesTargetTransition({
          deployment,
          recordsRoot,
          operationKind: "retire_target",
          targetExceptionRef: exception.ref,
          admissionEvidence: approvalEvidence(
            "approval://wrong-ticket",
            deployment.deploymentId,
            deployment.providerTarget.providerTargetIdentity,
          ),
        }),
      /requires reviewed approval evidence/,
    );
    await assert.rejects(
      async () =>
        await submitCloudflarePagesTargetTransition({
          deployment,
          recordsRoot,
          operationKind: "retire_target",
          targetExceptionRef: exception.ref,
          authorization: grantsFor({ principalId: "user:submitter" }, [
            {
              role: "submitter",
              scope: { kind: "deployment_id", value: deployment.deploymentId },
            },
          ]),
          admissionEvidence: approvalEvidence(
            exception.approvalEvidence,
            deployment.deploymentId,
            deployment.providerTarget.providerTargetIdentity,
          ),
        }),
      /not authorized/,
    );
  });
});
