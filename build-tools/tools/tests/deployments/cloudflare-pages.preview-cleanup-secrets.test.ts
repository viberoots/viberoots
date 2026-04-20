#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DEPLOYMENT_SECRET_FIXTURE_SCHEMA } from "../../deployments/deployment-secret-fixture.ts";
import { requireCloudflarePagesApiTokenForStep } from "../../deployments/cloudflare-pages-secret-steps.ts";
import type { CloudflarePagesAdmittedContext } from "../../deployments/cloudflare-pages-admission.ts";
import { cloudflarePagesApiTokenRequirements } from "./cloudflare-pages.fixture.ts";

const targetScope = "cloudflare-pages:web-platform-staging/pleomino-staging-pages";

function admittedContext(overrides: Partial<CloudflarePagesAdmittedContext> = {}) {
  return {
    lanePolicyRef: "//projects/deployments/pleomino-shared:lane",
    lanePolicyFingerprint: "sha256:lane",
    admissionPolicyRef: "//projects/deployments/pleomino-shared:staging_release",
    admissionPolicyFingerprint: "sha256:admission",
    environmentStage: "staging",
    secretRequirements: [],
    admittedSecretReferences: [],
    runtimeConfigRequirements: [],
    referenceResolutionPolicy: {
      secrets: "exact_admitted_references",
      runtimeConfig: "exact_contract_ids",
    },
    targetExceptionRefs: [],
    source: {
      mode: "source_run_reuse",
      sourceRef: "env/pleomino/staging",
      sourceRevision: "rev",
      artifactIdentity: "artifact",
      artifactTrustMode: "recorded_exact_artifact",
    },
    targetEnvironment: {
      mode: "stage_branch_snapshot",
      targetRef: "env/pleomino/staging",
      targetRevision: "rev",
      providerTargetIdentity: targetScope,
      lockScope: targetScope,
    },
    ...overrides,
  } satisfies CloudflarePagesAdmittedContext;
}

async function writeFixture(tmp: string, allowedSteps: string[]) {
  const fixturePath = path.join(tmp, "secret-fixture.json");
  await fsp.writeFile(
    fixturePath,
    JSON.stringify({
      schemaVersion: DEPLOYMENT_SECRET_FIXTURE_SCHEMA,
      contracts: {
        "secret://deployments/pleomino/cloudflare_api_token": {
          value: "cleanup-token",
          allowedSteps,
          targetScopes: [targetScope],
        },
      },
    }),
  );
  return fixturePath;
}

test("cloudflare preview cleanup rejects ambient provider tokens without admitted references", async () => {
  const original = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_API_TOKEN = "ambient-token";
  try {
    await assert.rejects(
      async () =>
        await requireCloudflarePagesApiTokenForStep({
          admittedContext: admittedContext(),
          step: "preview_cleanup",
          requirements: [],
        }),
      /requires declared secret requirement "cloudflare_api_token"/,
    );
  } finally {
    if (original === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = original;
  }
});

test("cloudflare preview cleanup rejects credentials not authorized for cleanup", async () => {
  const tmpParent = path.join(process.cwd(), "buck-out", "tmp");
  await fsp.mkdir(tmpParent, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(tmpParent, "cf-cleanup-"));
  const fixturePath = await writeFixture(tmp, ["publish"]);
  const original = process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH;
  process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH = fixturePath;
  try {
    await assert.rejects(
      async () =>
        await requireCloudflarePagesApiTokenForStep({
          admittedContext: admittedContext({
            secretRequirements: cloudflarePagesApiTokenRequirements(),
            admittedSecretReferences: [
              {
                name: "cloudflare_api_token",
                step: "preview_cleanup",
                contractId: "secret://deployments/pleomino/cloudflare_api_token",
                required: true,
                backend: "vault",
                referenceId: "vault:secret://deployments/pleomino/cloudflare_api_token",
                targetScope,
                backendRef: "secret://deployments/pleomino/cloudflare_api_token",
                selectorRef: "secret://deployments/pleomino/cloudflare_api_token",
                resolvedAt: "2026-04-19T00:00:00.000Z",
                refreshMode: "none",
                credentialClass: "routine",
              },
            ],
          }),
          step: "preview_cleanup",
          requirements: cloudflarePagesApiTokenRequirements(),
        }),
      /not authorized for lifecycle step preview_cleanup/,
    );
  } finally {
    if (original === undefined) delete process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH;
    else process.env.BNX_DEPLOYMENT_SECRET_FIXTURE_PATH = original;
  }
});
