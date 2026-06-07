#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveProtectedSharedServiceClient,
  serviceClientSelectionEvidence,
  shouldUseProtectedSharedServiceRoute,
} from "../../deployments/deployment-service-client-selection";
import { resolveServiceClientForOperator } from "../../deployments/deploy-control-plane-operator-client";
import { runS3StaticDeployFrontDoor } from "../../deployments/s3-static-front-door";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import { kubernetesDeploymentFixture } from "./kubernetes.fixture";
import { s3StaticDeploymentFixture } from "./s3-static.fixture";
import { vercelDeploymentFixture } from "./vercel.fixture";
import { withProjectConfig } from "./deployment-contexts.scope.helpers";

const RUNTIME_REF = "runtime://github-actions/control-plane-token";
const PROD_RUNTIME_REF = "runtime://github-actions/prod-control-plane-token";

function deployment(tokenRef = RUNTIME_REF) {
  return cloudflarePagesDeploymentFixture({
    controlPlane: controlPlane("prod", "https://control.prod.example", tokenRef),
    deploymentContext: {
      name: "prod",
      controlPlane: controlPlane("prod", "https://control.prod.example", tokenRef),
    },
  });
}

test("context-selected route is forced for all protected/shared provider front doors", () => {
  for (const providerDeployment of [
    deployment(),
    withControlPlane(s3StaticDeploymentFixture()),
    withControlPlane(kubernetesDeploymentFixture()),
    withControlPlane(vercelDeploymentFixture()),
  ]) {
    assert.equal(
      shouldUseProtectedSharedServiceRoute({
        deployment: providerDeployment,
        requireServiceForProtectedShared: false,
      }),
      true,
    );
  }
});

test("context-selected s3 front door rejects direct records mutation paths", async () => {
  for (const flag of ["records-root", "control-plane-database-url"]) {
    await assert.rejects(
      () =>
        runS3StaticDeployFrontDoor({
          workspaceRoot: process.cwd(),
          deployment: withControlPlane(s3StaticDeploymentFixture()),
          requireServiceForProtectedShared: false,
          publishOnly: false,
          provisionOnly: true,
          rollback: false,
          sourceRunId: "",
          artifactDirFlag: "",
          controlPlaneUrl: "",
          allowControlPlaneOverride: false,
          hasFlag: (candidate) => candidate === flag,
        }),
      new RegExp(`service-only s3-static deploy does not support --${flag}`),
    );
  }
});

test("two deployments with different selected contexts resolve independently", async () => {
  await withRuntimeHostConfig(async () => {
    const staging = deployment();
    const prod = deployment(PROD_RUNTIME_REF);
    prod.controlPlane = controlPlane("prod-2", "https://control.prod-2.example", PROD_RUNTIME_REF);
    const env = {
      DEPLOY_CONTROL_PLANE_TOKEN: "staging-token",
      PROD_CONTROL_PLANE_TOKEN: "prod-token",
    };
    const [stagingClient, prodClient] = await Promise.all([
      resolveProtectedSharedServiceClient({ deployment: staging, context: "staging deploy", env }),
      resolveProtectedSharedServiceClient({ deployment: prod, context: "prod deploy", env }),
    ]);
    assert.equal(stagingClient.controlPlaneUrl, "https://control.prod.example");
    assert.equal(stagingClient.controlPlaneToken, "staging-token");
    assert.equal(prodClient.controlPlaneUrl, "https://control.prod-2.example");
    assert.equal(prodClient.controlPlaneToken, "prod-token");
  });
});

test("invalid control-plane token refs reject config and plaintext schemes", async () => {
  await assert.rejects(
    () =>
      resolveProtectedSharedServiceClient({
        deployment: deployment("config://deploy/control-plane-token"),
        context: "cloudflare-pages shared_nonprod mutation",
        env: {},
      }),
    /controlPlaneTokenRef must be a secret:\/\/ or runtime:\/\/ ref/,
  );
  await assert.rejects(
    () =>
      resolveProtectedSharedServiceClient({
        deployment: deployment("plaintext-token"),
        context: "cloudflare-pages shared_nonprod mutation",
        env: {},
      }),
    /controlPlaneTokenRef must be a secret:\/\/ or runtime:\/\/ ref/,
  );
});

test("runtime token refs require runtimeHosts binding and do not print token material", async () => {
  await withProjectConfig({}, async () => {
    await assert.rejects(
      () =>
        resolveProtectedSharedServiceClient({
          deployment: deployment(),
          context: "cloudflare-pages shared_nonprod mutation",
          env: { DEPLOY_CONTROL_PLANE_TOKEN: "super-secret-runtime-token" },
        }),
      (error) => {
        assert(error instanceof Error);
        assert.match(error.message, /missing runtimeHost github-actions/);
        assert(!error.message.includes("super-secret-runtime-token"));
        return true;
      },
    );
  });
  await withRuntimeHostConfig(async () => {
    const client = await resolveProtectedSharedServiceClient({
      deployment: deployment(),
      context: "cloudflare-pages shared_nonprod mutation",
      env: { DEPLOY_CONTROL_PLANE_TOKEN: "super-secret-runtime-token" },
    });
    const evidence = JSON.stringify(serviceClientSelectionEvidence(client));
    assert(!evidence.includes("super-secret-runtime-token"));
    assert(evidence.includes(RUNTIME_REF));
  });
});

test("operator resolver enforces context selection and explicit override", async () => {
  await withRuntimeHostConfig(async () => {
    await withArgv(["--control-plane-url", "https://other.example"], async () => {
      await assert.rejects(
        () =>
          resolveServiceClientForOperator({
            workspaceRoot: process.cwd(),
            deployment: deployment(),
            actionLabel: "deploy --status",
          }),
        /disagrees with deployment context controlPlane prod/,
      );
    });
    await withArgv(
      [
        "--control-plane-url",
        "https://override.example",
        "--control-plane-token",
        "override-token",
        "--allow-control-plane-override",
      ],
      async () => {
        const client = await resolveServiceClientForOperator({
          workspaceRoot: process.cwd(),
          deployment: deployment(),
          actionLabel: "deploy --status",
        });
        assert.equal(client.controlPlaneUrl, "https://override.example");
        assert.equal(client.controlPlaneToken, "override-token");
        assert.equal(client.selectedSource, "explicit_override");
      },
    );
    await withArgv(["--profile", "mini"], async () => {
      await assert.rejects(
        () =>
          resolveServiceClientForOperator({
            workspaceRoot: process.cwd(),
            deployment: deployment(),
            actionLabel: "deploy --status",
          }),
        /cannot use --profile\/--profile-root when deployment context selects a controlPlane/,
      );
    });
  });
});

test("ambient control-plane URL cannot override context selection", async () => {
  await withRuntimeHostConfig(async () => {
    await assert.rejects(
      () =>
        resolveProtectedSharedServiceClient({
          deployment: deployment(),
          allowControlPlaneOverride: true,
          context: "cloudflare-pages shared_nonprod mutation",
          env: {
            VBR_DEPLOY_CONTROL_PLANE_URL: "https://ambient.example",
            DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token",
          },
        }),
      /ambient control-plane URLs are accepted only for commands without deployment context/,
    );
    const client = await resolveProtectedSharedServiceClient({
      deployment: deployment(),
      controlPlaneUrl: "https://override.example",
      controlPlaneToken: "override-token",
      allowControlPlaneOverride: true,
      context: "cloudflare-pages shared_nonprod mutation",
      env: { DEPLOY_CONTROL_PLANE_TOKEN: "runtime-token" },
    });
    assert.equal(client.selectedSource, "explicit_override");
    assert.equal(client.controlPlaneUrl, "https://override.example");
  });
});

function withRuntimeHostConfig(run: () => Promise<void>) {
  return withProjectConfig(
    {
      runtimeHosts: {
        "github-actions": {
          bindings: {
            "control-plane-token": { kind: "env", name: "DEPLOY_CONTROL_PLANE_TOKEN" },
            "prod-control-plane-token": { kind: "env", name: "PROD_CONTROL_PLANE_TOKEN" },
          },
        },
      },
    },
    run,
  );
}

function withControlPlane<T extends { protectionClass: string }>(base: T): T {
  return { ...base, controlPlane: controlPlane("prod", "https://control.prod.example") };
}

function controlPlane(name: string, controlPlaneUrl: string, tokenRef = RUNTIME_REF) {
  return {
    name,
    serviceClient: { controlPlaneUrl, controlPlaneTokenRef: tokenRef },
    records: { backend: "service" as const },
  };
}

async function withArgv(args: string[], run: () => Promise<void>) {
  const oldArgv = process.argv;
  process.argv = ["node", "test", ...args];
  try {
    await run();
  } finally {
    process.argv = oldArgv;
  }
}
