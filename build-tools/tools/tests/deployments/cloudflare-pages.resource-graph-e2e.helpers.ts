#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { localHarnessControlPlaneDatabaseUrl } from "../../deployments/nixos-shared-host-control-plane-backend";
import { NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA } from "../../deployments/nixos-shared-host-control-plane-api-contract";
import { startNixosSharedHostControlPlaneServer } from "../../deployments/nixos-shared-host-control-plane-server";
import { startNixosSharedHostControlPlaneWorkerLoop } from "../../deployments/nixos-shared-host-control-plane-worker-loop";
import { LOCAL_FIXTURE_SERVICE_ENV } from "../../deployments/deployment-service-transport-policy";
import { artifactIdentityForStaticWebappDir } from "../../deployments/static-webapp-artifacts";
import { createCloudflarePagesSubmissionId } from "../../deployments/cloudflare-pages-control-plane-shared";
import { serviceSubmissionAdmissionEvidence } from "../../deployments/deployment-service-client-contract";
import {
  createDeploymentArtifactChallenge,
  deploymentServicePrincipalForToken,
} from "../../deployments/deployment-artifact-challenges";
import { collectCloudflarePagesRuntimeEvidenceHandoff } from "../../deployments/cloudflare-pages-resource-graph-runtime-evidence";
import { viberootsToolScript } from "./deployment-command";
import {
  cloudflarePagesApiTokenRequirements,
  cloudflarePagesDeploymentFixture,
  installCloudflarePagesTargets,
} from "./cloudflare-pages.fixture";
import { installFakeCloudflarePagesWrangler } from "./cloudflare-pages.fake-wrangler";
import { startCloudflarePagesPublicServer } from "./cloudflare-pages.public-server";
import { writeReviewedLaneAdmissionEvidenceJson } from "./deployment-lane-governance.fixture";
import {
  ensureNixosSharedHostReviewedSourceRef,
  nixosSharedHostLanePolicyFixture,
} from "./nixos-shared-host.fixture";
import { installHarnessClientProfile } from "./nixos-shared-host.remote-exec.install.helpers";
import { fakeJwt } from "./deploy-vault-jwt.test-helpers";
import { startFakeVaultServer } from "./vault.test-server";
import {
  fakeCloudflareOverrides,
  writeCloudflareServiceArtifact,
  writeWranglerConfig,
} from "./cloudflare-pages.service-flow.helpers";

export const RESOURCE_GRAPH_E2E_TOKEN = "resource-graph-e2e-token";

export async function withCloudflarePagesResourceGraphE2E(
  tmp: string,
  $: any,
  fn: (ctx: Awaited<ReturnType<typeof prepareCloudflarePagesResourceGraphE2E>>) => Promise<void>,
) {
  const ctx = await prepareCloudflarePagesResourceGraphE2E(tmp, $);
  try {
    await fn(ctx);
  } finally {
    await ctx.close();
  }
}

async function prepareCloudflarePagesResourceGraphE2E(tmp: string, $: any) {
  const issuer = "https://identity.example.test";
  const workerJwt = fakeJwt({
    iss: issuer,
    aud: "deployments-vault",
    azp: "deployment-runner",
    deployment_environment: "mini",
    repository: "viberoots/viberoots",
  });
  const vault = await startFakeVaultServer(
    {
      "secret://deployments/sample-webapp/cloudflare_api_token": {
        currentVersion: "1",
        versions: { "1": { value: "service-secret-token" } },
      },
    },
    { jwtAuth: { role: "deploy-sample-webapp-read", jwt: workerJwt } },
  );
  const deployment = cloudflarePagesDeploymentFixture({
    lanePolicy: nixosSharedHostLanePolicyFixture({ defaultClientProfile: "mini" }),
    secretRequirements: cloudflarePagesApiTokenRequirements(),
    vaultRuntime: {
      addr: vault.addr,
      oidcIssuer: issuer,
      audience: "deployments-vault",
      deploymentClientId: "deployment-runner",
      deploymentEnvironment: "mini",
      roleName: "deploy-sample-webapp-read",
      preferredCredentialSource: "external_oidc_token",
      externalOidcTokenEnv: "VBR_WORKER_OIDC_TOKEN",
    },
  });
  const recordsRoot = path.join(tmp, "records");
  const backend = { recordsRoot, databaseUrl: localHarnessControlPlaneDatabaseUrl(recordsRoot) };
  const fake = await installFakeCloudflarePagesWrangler(tmp);
  await writeCloudflareServiceArtifact(path.join(tmp, "artifact-a"), "<html>artifact-a</html>\n");
  await writeCloudflareServiceArtifact(path.join(tmp, "artifact-b"), "<html>artifact-b</html>\n");
  await writeWranglerConfig(
    path.join(tmp, "projects", "deployments", "sample-webapp", "staging", "wrangler.jsonc"),
  );
  await installCloudflarePagesTargets(tmp, [deployment]);
  await ensureNixosSharedHostReviewedSourceRef(tmp, $, deployment);
  const admissionEvidenceJson = await writeReviewedLaneAdmissionEvidenceJson({
    tmp,
    $,
    deploymentLabel: deployment.label,
    deployment,
  });
  const env = {
    ...fakeCloudflareOverrides(fake),
    VBR_WORKER_OIDC_TOKEN: workerJwt,
    [LOCAL_FIXTURE_SERVICE_ENV]: "1",
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const server = await startCloudflarePagesPublicServer({
    deployment,
    publishRoot: fake.publishRoot,
    tlsRoot: tmp,
  });
  const controlPlane = await startNixosSharedHostControlPlaneServer({
    workspaceRoot: tmp,
    paths: {
      statePath: path.join(tmp, "state.json"),
      hostRoot: path.join(tmp, "host"),
      recordsRoot,
    },
    backendDatabaseUrl: backend.databaseUrl,
    token: RESOURCE_GRAPH_E2E_TOKEN,
    localFixture: true,
    webUi: { enabled: true, basePath: "/ops" },
    mcp: { enabled: true, basePath: "/mcp" },
  });
  const worker = startNixosSharedHostControlPlaneWorkerLoop({
    workspaceRoot: tmp,
    recordsRoot,
    backendDatabaseUrl: backend.databaseUrl,
    workerId: "resource-graph-e2e-worker",
  });
  const profileRoot = await installHarnessClientProfile($, tmp, controlPlane.url);
  return {
    tmp,
    backend,
    deployment,
    admissionEvidenceJson,
    controlPlane,
    profileRoot,
    smokePort: server.port,
    env,
    close: async () => {
      try {
        await worker.close();
        await controlPlane.close();
        await server.close();
        await vault.close();
      } finally {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
  };
}

export async function runCloudflarePagesGraphSequence(
  ctx: Awaited<ReturnType<typeof prepareCloudflarePagesResourceGraphE2E>>,
  $: any,
) {
  const env = {
    ...process.env,
    ...ctx.env,
    VBR_DEPLOY_CONTROL_PLANE_TOKEN: RESOURCE_GRAPH_E2E_TOKEN,
  };
  const deploy = async (args: string[]) =>
    JSON.parse(
      String(
        (
          await $({
            cwd: ctx.tmp,
            env,
            stdio: "pipe",
          })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} ${args}`
        ).stdout,
      ),
    );
  const common = [
    "--deployment",
    ctx.deployment.label,
    "--admission-evidence-json",
    ctx.admissionEvidenceJson,
    "--smoke-connect-host",
    "127.0.0.1",
    "--smoke-connect-port",
    String(ctx.smokePort),
    "--smoke-connect-protocol",
    "https:",
  ];
  const principal = deploymentServicePrincipalForToken(RESOURCE_GRAPH_E2E_TOKEN);
  const artifactAIdentity = await artifactIdentityForStaticWebappDir(
    path.join(ctx.tmp, "artifact-a"),
  );
  await createDeploymentArtifactChallenge({
    backend: ctx.backend,
    principalId: principal.principalId,
    keyId: principal.keyId,
    finalizedStagedArtifactReference: artifactAIdentity,
    request: {
      schemaVersion: NIXOS_SHARED_HOST_CONTROL_PLANE_SUBMIT_REQUEST_SCHEMA,
      submissionId: createCloudflarePagesSubmissionId(),
      submittedAt: new Date().toISOString(),
      deployment: ctx.deployment as any,
      operationKind: "deploy",
      expectedArtifactIdentity: artifactAIdentity,
      admissionEvidence: serviceSubmissionAdmissionEvidence(
        JSON.parse(await fsp.readFile(ctx.admissionEvidenceJson, "utf8")),
      ),
    } as any,
  });
  const first = await deploy([
    ...common,
    "--artifact-dir",
    path.join(ctx.tmp, "artifact-a"),
    "--profile-root",
    ctx.profileRoot,
  ]);
  const second = await deploy([
    ...common,
    "--artifact-dir",
    path.join(ctx.tmp, "artifact-b"),
    "--control-plane-url",
    ctx.controlPlane.url,
  ]);
  const rollback = await deploy([
    ...common,
    "--publish-only",
    "--rollback",
    "--source-run-id",
    first.deployRunId,
    "--control-plane-url",
    ctx.controlPlane.url,
  ]);
  const runtimeEvidenceHandoff = await collectCloudflarePagesRuntimeEvidenceHandoff({
    backend: ctx.backend,
    deploymentId: ctx.deployment.deploymentId,
    runs: { first, second, rollback },
  });
  return { first, second, rollback, runtimeEvidenceHandoff };
}
