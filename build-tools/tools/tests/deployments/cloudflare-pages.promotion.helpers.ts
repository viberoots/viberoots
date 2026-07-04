#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { cloudflarePagesDeploymentFixture } from "./cloudflare-pages.fixture";
import {
  nixosSharedHostAdmissionPolicyFixture,
  nixosSharedHostDeploymentFixture,
} from "./nixos-shared-host.fixture";

export async function writeDeploymentJson(filePath: string, deployment: unknown) {
  await fsp.writeFile(filePath, JSON.stringify(deployment, null, 2) + "\n", "utf8");
}

export async function writeWranglerConfig(root: string) {
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await fsp.writeFile(root, '{\n  "compatibility_date": "2026-03-18"\n}\n', "utf8");
}

export function sampleWebappDevDeployment() {
  const lanePolicy = {
    ...cloudflarePagesDeploymentFixture().lanePolicy,
    promotionCompatibility: {
      crossProviderPromotionEdges: ["dev->staging"],
    },
  };
  return nixosSharedHostDeploymentFixture({
    deploymentId: "sample-webapp-dev",
    label: "//projects/deployments/sample-webapp/dev:deploy",
    lanePolicy,
    lanePolicyRef: lanePolicy.ref,
    component: { kind: "static-webapp", target: "//projects/apps/sample-webapp:app" },
    runtime: { appName: "sample-webapp", containerPort: 3000, healthPath: "/healthz" },
  });
}

export function sampleWebappProdDeployment() {
  const lanePolicy = {
    ...cloudflarePagesDeploymentFixture().lanePolicy,
    promotionCompatibility: {
      crossProviderPromotionEdges: ["dev->staging"],
    },
  };
  const admissionPolicy = nixosSharedHostAdmissionPolicyFixture({
    ref: "//projects/deployments/sample-webapp/shared:prod_release",
    name: "prod_release",
    allowedRefs: ["refs/tags/release/*"],
    requiredChecks: [],
    requiredApprovals: ["release-owner"],
    fingerprint: "sha256:admission-sample-webapp-prod",
  });
  return cloudflarePagesDeploymentFixture({
    deploymentId: "sample-webapp-prod",
    label: "//projects/deployments/sample-webapp/prod:deploy",
    lanePolicy,
    lanePolicyRef: lanePolicy.ref,
    protectionClass: "production_facing",
    environmentStage: "prod",
    admissionPolicyRef: admissionPolicy.ref,
    admissionPolicy,
    providerTarget: {
      account: "web-platform-prod",
      project: "sample-webapp-prod-pages",
      id: "sample-webapp-prod-pages",
      canonicalUrl: "https://sample-webapp-prod-pages.pages.dev/",
      providerTargetIdentity: "cloudflare-pages:web-platform-prod/sample-webapp-prod-pages",
    },
  });
}

export function fakeCloudflareEnv(fake: { binDir: string; publishRoot: string; logPath: string }) {
  return {
    ...process.env,
    PATH: `${fake.binDir}:${process.env.PATH || ""}`,
    VBR_CLOUDFLARE_FAKE_PUBLISH_ROOT: fake.publishRoot,
    VBR_CLOUDFLARE_FAKE_WRANGLER_LOG: fake.logPath,
    VBR_CLOUDFLARE_PAGES_WRANGLER_BIN: path.join(fake.binDir, "wrangler"),
  };
}
