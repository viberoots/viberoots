#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveInitialCloudflarePagesAdmittedContext } from "../../deployments/cloudflare-pages-admission";
import {
  extractCloudflarePagesDeployments,
  extractS3StaticDeployments,
} from "../../deployments/contract";
import { resolveInfisicalCredentialFromRuntime } from "../../deployments/deployment-secret-infisical-runtime-credentials";
import {
  cloudflareDeployment,
  cloudflareNodes,
  s3Deployment,
  s3Nodes,
  withEnv,
  withProjectConfig,
  writeJson,
} from "./deployment-contexts.scope.helpers";

test("deployment_context differentiates AWS accounts and Infisical projects", async () => {
  await withProjectConfig(
    {
      controlPlanes: JSON.parse(
        '{"test":{"serviceClient":{"controlPlaneUrl":"https://control.example","controlPlaneTokenRef":"runtime://github-actions/control-plane-token"}}}',
      ),
      deploymentContexts: {
        "aws-staging": {
          controlPlane: "test",
          aws: { accountId: "111122223333", defaultRegion: "us-west-2" },
          infisical: { projectId: "proj-staging", environment: "staging" },
        },
        "aws-prod": {
          controlPlane: "test",
          aws: { accountId: "444455556666", defaultRegion: "us-east-1" },
          infisical: { projectId: "proj-prod", environment: "prod" },
        },
      },
    },
    async () => {
      const { deployments, errors } = extractS3StaticDeployments(
        s3Nodes([
          s3Deployment({ deployment_context: "aws-staging" }),
          s3Deployment({
            name: "//projects/deployments/sample-webapp/prod-s3:deploy",
            deployment_context: "aws-prod",
          }),
        ]),
      );
      assert.deepEqual(errors, []);
      const byLabel = new Map(deployments.map((deployment) => [deployment.label, deployment]));
      const staging = byLabel.get("//projects/deployments/sample-webapp/staging-s3:deploy");
      const prod = byLabel.get("//projects/deployments/sample-webapp/prod-s3:deploy");
      assert.equal(staging?.providerTarget.account, "111122223333");
      assert.equal(staging?.infisicalRuntime?.projectId, "proj-staging");
      assert.equal(prod?.providerTarget.account, "444455556666");
      assert.equal(prod?.infisicalRuntime?.projectId, "proj-prod");
    },
  );
});

test("local context override evidence is redacted and the guard rejects overrides", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "admin-prod": {
          cloudflare: { account: "shared-platform", projectName: "admin-prod-pages" },
          infisical: {
            clientSecretRef: "secret://shared/bootstrap/client-secret",
            projectId: "proj-shared",
          },
        },
      },
    },
    async () => {
      await writeJson("projects/config/local.json", {
        deploymentContexts: {
          "admin-prod": {
            cloudflare: { account: "local-platform" },
            infisical: { clientSecretRef: "secret://local/bootstrap/client-secret" },
          },
        },
      });
      const deployment = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "admin-prod" })]),
      ).deployments[0];
      assert.equal(deployment?.providerTarget.account, "local-platform");
      assert.ok(
        deployment?.deploymentContext?.localOverrides?.some(
          (entry) =>
            entry.path === "deploymentContexts.admin-prod.infisical.clientSecretRef" &&
            entry.localValue === "<redacted>",
        ),
      );
      await withEnv("VBR_DISALLOW_LOCAL_OVERRIDES", "1", async () => {
        const { errors } = extractCloudflarePagesDeployments(
          cloudflareNodes([cloudflareDeployment({ deployment_context: "admin-prod" })]),
        );
        assert.ok(errors.some((entry) => entry.includes("local project config overrides")));
      });
    },
  );
});

test("context-owned bootstrap and provider secret refs are routed", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "token-prod": {
          secretBackend: "vault/default",
          cloudflare: {
            account: "web-platform",
            projectName: "sample-webapp-prod-pages",
            apiTokenRef: "secret://providers/cloudflare/api-token",
          },
          infisical: {
            clientIdRef: "secret://bootstrap/infisical/client-id",
            clientSecretRef: "secret://bootstrap/infisical/client-secret",
          },
        },
      },
    },
    async () => {
      const deployment = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "token-prod" })]),
      ).deployments[0];
      assert.equal(deployment?.secretBackend, "vault");
      assert.equal(deployment?.secretRequirements.length, 2);
      assert.equal(
        deployment?.secretRequirements[0]?.contractId,
        "secret://providers/cloudflare/api-token",
      );
      assert.equal(deployment?.deploymentContext?.secretRefs?.[0]?.route, "secret_backend");
      assert.ok(
        deployment?.deploymentContext?.secretRefs?.some(
          (entry) => entry.field === "clientSecretRef" && entry.route === "bootstrap",
        ),
      );
    },
  );
});

test("context-owned Infisical bootstrap refs resolve through bootstrap SprinkleRef", async () => {
  await withProjectConfig(
    {
      sprinkleref: {
        version: 1,
        defaultCategory: "main",
        categories: {
          main: { backend: "local-file", file: ".local/main.json" },
          bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
        },
      },
      deploymentContexts: {
        "bootstrap-prod": {
          secretBackend: "infisical/default",
          cloudflare: {
            account: "web-platform",
            projectName: "sample-webapp-prod-pages",
            apiTokenRef: "secret://providers/cloudflare/api-token",
          },
          infisical: {
            host: "https://app.infisical.com",
            projectId: "project-prod",
            environment: "prod",
            clientIdRef: "secret://bootstrap/infisical/client-id",
            clientSecretRef: "secret://bootstrap/infisical/client-secret",
          },
        },
      },
    },
    async () => {
      await writeJson(".local/bootstrap.json", {
        "secret://bootstrap/infisical/client-id": "client-id",
        "secret://bootstrap/infisical/client-secret": "client-secret",
      });
      const deployment = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "bootstrap-prod" })]),
      ).deployments[0];
      const credential = await resolveInfisicalCredentialFromRuntime({
        runtime: deployment!.infisicalRuntime!,
        env: {},
      });
      assert.equal(credential.kind, "universal_auth");
      assert.equal(credential.clientId, "client-id");
      assert.equal(credential.clientSecret, "client-secret");
    },
  );
});

test("admission evidence carries deployment_context-derived metadata", async () => {
  await withProjectConfig(
    {
      deploymentContexts: {
        "admission-prod": {
          secretBackend: "vault/default",
          cloudflare: {
            account: "web-platform",
            projectName: "sample-webapp-prod-pages",
            apiTokenRef: "secret://providers/cloudflare/api-token",
          },
        },
      },
    },
    async () => {
      const deployment = extractCloudflarePagesDeployments(
        cloudflareNodes([cloudflareDeployment({ deployment_context: "admission-prod" })]),
      ).deployments[0];
      assert.ok(deployment);
      const admitted = await resolveInitialCloudflarePagesAdmittedContext({
        workspaceRoot: process.cwd(),
        deployment,
        artifactIdentity: "static-webapp:abc123",
        deferSecretReferenceResolution: true,
      });
      assert.equal(admitted.deploymentContext?.name, "admission-prod");
      assert.equal(admitted.secretRequirements[0]?.source, "deployment_context");
    },
  );
});

test("context scenarios reject secret_backend_profile and preserve legacy backend selectors", () => {
  const profileErrors = extractCloudflarePagesDeployments(
    cloudflareNodes([
      cloudflareDeployment({
        deployment_context: "sample-webapp-staging",
        secret_backend_profile: "infisical-default",
      }),
    ]),
  ).errors;
  assert.ok(profileErrors.some((entry) => entry.includes("secret_backend_profile")));
  const legacy = extractCloudflarePagesDeployments(
    cloudflareNodes([
      cloudflareDeployment({
        secret_backend: "infisical/default",
        provider_target: { account: "web-platform", project: "sample-webapp-pages" },
      }),
    ]),
  );
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.deployments[0]?.secretBackendProfile, "infisical-default");
});
