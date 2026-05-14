#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolve as resolvePath } from "node:path";
import { createCloudflarePagesControlPlaneSnapshot } from "../../deployments/cloudflare-pages-control-plane-snapshot";
import { submitCloudflarePagesControlPlaneDeploy } from "../../deployments/cloudflare-pages-control-plane";
import { activateDeploymentSecretContext } from "../../deployments/deployment-secret-context";
import type { CloudflarePagesDeployment } from "../../deployments/contract";
import {
  admitStaticWebappArtifact,
  type AdmittedStaticWebappArtifact,
} from "../../deployments/static-webapp-artifacts";
import { runInTemp } from "../lib/test-helpers";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { deploymentAdmissionEvidenceFixture } from "./deployment-admission.fixture";
import {
  infisicalRequirement,
  infisicalRuntime,
  infisicalSecret,
  infisicalTestContext,
} from "./deployment-secret-infisical.fixture";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { startFakeInfisicalServer } from "./infisical.test-server";

const explicitCommit = "0123456789abcdef0123456789abcdef01234567";
const clientSecret = "client-secret-value";

function deployment(siteUrl: string): CloudflarePagesDeployment {
  const reviewedRef = `commit:${explicitCommit}`;
  return {
    ...cloudflarePagesDeploymentFixture({
      lanePolicy: nixosSharedHostLanePolicyFixture({
        sourceRefPolicy: { staging: reviewedRef },
      }),
      admissionPolicy: nixosSharedHostAdmissionPolicyFixture({
        allowedRefs: [reviewedRef],
        requiredChecks: [],
      }),
      secretRequirements: [infisicalRequirement],
    }),
    secretBackend: "infisical",
    infisicalRuntime: { ...infisicalRuntime, siteUrl },
  };
}

async function writeArtifact(root: string, html: string): Promise<void> {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, "index.html"), html, "utf8");
}

async function writeWranglerConfig(filePath: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

function artifact(identity: string, recordsRoot: string): AdmittedStaticWebappArtifact {
  return {
    kind: "static-webapp",
    identity,
    storedArtifactPath: resolvePath(recordsRoot, "artifacts", identity),
    provenancePath: resolvePath(recordsRoot, "artifacts", `${identity}.json`),
  };
}

test("cloudflare-pages promotion uses source artifact and fresh target Infisical admission", async () => {
  const server = await startFakeInfisicalServer(
    { clientId: "id", clientSecret, accessToken: "token" },
    [infisicalSecret()],
  );
  const restore = activateDeploymentSecretContext(
    infisicalTestContext(server.siteUrl, { clientSecret }),
  );
  try {
    const recordsRoot = "/tmp/cloudflare-promotion-infisical-records";
    const sourceArtifact = artifact("static-webapp:source-artifact", recordsRoot);
    const snapshot = await createCloudflarePagesControlPlaneSnapshot(
      {
        workspaceRoot: process.cwd(),
        deployment: deployment(server.siteUrl),
        recordsRoot,
        operationKind: "promotion",
        artifact: sourceArtifact,
        source: {
          record: {
            deployRunId: "deploy-source-1",
            deploymentId: "pleomino-dev",
          },
          replaySnapshotPath: "/records/replay/deploy-source-1/snapshot.json",
        },
      },
      "submission-promotion-infisical",
    );
    assert.equal(snapshot.action.kind, "deploy");
    assert.equal(snapshot.action.publishInput.artifact.identity, sourceArtifact.identity);
    assert.equal(snapshot.admittedContext.source.sourceRunId, "deploy-source-1");
    assert.equal(snapshot.admittedContext.admittedSecretReferences[0]?.backend, "infisical");
    assert.match(
      snapshot.admittedContext.admittedSecretReferences[0]?.referenceId || "",
      /^infisical:/,
    );
  } finally {
    restore();
    await server.close();
  }
});

test("cloudflare-pages persisted records and snapshots keep Infisical selectors non-secret", async () => {
  await runInTemp("cloudflare-pages-infisical-records", async (tmp) => {
    const server = await startFakeInfisicalServer(
      { clientId: "id", clientSecret, accessToken: "token" },
      [infisicalSecret()],
    );
    const deploy = deployment(server.siteUrl);
    const artifactDir = path.join(tmp, "artifact");
    const recordsRoot = path.join(tmp, "records");
    const fake = await installFakeCloudflarePagesWrangler(tmp);
    await writeArtifact(artifactDir, "<html>infisical deploy</html>\n");
    await writeWranglerConfig(
      path.join(tmp, "projects", "deployments", "pleomino-staging", "wrangler.jsonc"),
    );
    const admittedArtifact = await admitStaticWebappArtifact({ recordsRoot, artifactDir });
    const publicServer = await startCloudflarePagesPublicServer({
      deployment: deploy,
      publishRoot: fake.publishRoot,
      tlsRoot: tmp,
    });
    const originalEnv = { ...process.env };
    const restore = activateDeploymentSecretContext(
      infisicalTestContext(server.siteUrl, { clientSecret }),
    );
    Object.assign(process.env, {
      PATH: `${fake.binDir}:${originalEnv.PATH || ""}`,
      VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
      VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
      VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
    });
    delete process.env.VBR_DEPLOYMENT_SECRET_FIXTURE_PATH;
    try {
      const result = await submitCloudflarePagesControlPlaneDeploy({
        workspaceRoot: tmp,
        deployment: deploy,
        artifact: admittedArtifact,
        recordsRoot,
        admissionEvidence: deploymentAdmissionEvidenceFixture({
          deployment: deploy,
          operationKind: "deploy",
          sourceRevision: explicitCommit,
          artifactIdentity: admittedArtifact.identity,
        }),
        smokeConnectOverride: {
          protocol: "https:",
          hostname: "127.0.0.1",
          port: publicServer.port,
          rejectUnauthorized: false,
        },
      });
      const recordText = await fsp.readFile(result.recordPath, "utf8");
      const record = JSON.parse(recordText);
      const executionText = await fsp.readFile(record.controlPlane.executionSnapshotPath, "utf8");
      const replayText = await fsp.readFile(record.replaySnapshotPath, "utf8");
      const admitted = record.admittedContext.admittedSecretReferences[0];
      assert.equal(admitted.backend, "infisical");
      assert.match(admitted.referenceId, /^infisical:/);
      assert.match(admitted.selectorRef, /^proj_123:prod:/);
      assert.doesNotMatch(recordText + executionText + replayText, /runtime-token-v3/);
      assert.doesNotMatch(recordText + executionText + replayText, new RegExp(clientSecret));
      assert.equal(JSON.parse(executionText).infisicalRuntime.siteUrl, server.siteUrl);
      assert.equal(
        JSON.parse(replayText).admittedContext.admittedSecretReferences[0].backend,
        "infisical",
      );
    } finally {
      restore();
      process.env = originalEnv;
      await publicServer.close();
      await server.close();
    }
  });
});
