#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { writeTempCloudflareValidationWorkspace } from "./deploy.front-door.fixture";
import { runInTemp } from "../lib/test-helpers";

test("deploy --operator-readiness summarizes selected context and existing setup evidence", async () => {
  await runInTemp("deploy-operator-readiness", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp, { deploymentContext: "demo-staging" });
    await writeJson(tmp, "projects/config/shared.json", {
      schemaVersion: "viberoots-project-config@1",
      runtimeHosts: {
        "github-actions": {
          bindings: {
            "control-plane-token": { kind: "env", name: "DEPLOY_CONTROL_PLANE_TOKEN" },
          },
        },
      },
      controlPlanes: {
        prod: {
          serviceClient: {
            controlPlaneUrl: "https://control.prod.example",
            controlPlaneTokenRef: "runtime://github-actions/control-plane-token",
          },
        },
      },
      deploymentContexts: {
        "demo-staging": {
          controlPlane: "prod",
          secretBackend: "infisical/default",
          cloudflare: { account: "web-platform-staging", projectName: "demo-staging-pages" },
        },
      },
    });
    await writeAwsAccountEvidence(tmp);
    const result = await $({
      cwd: tmp,
      env: { ...process.env, DEPLOY_CONTROL_PLANE_TOKEN: "super-secret-runtime-token" },
      stdio: "pipe",
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-staging:deploy --operator-readiness`;
    const text = String(result.stdout);
    assert.match(text, /Deployment Operator Readiness/);
    assert.match(text, /context: demo-staging/);
    assert.match(text, /controlPlane: prod/);
    assert.match(text, /secretBackend: infisical\/infisical-default/);
    assert.match(text, /runtime credential binding is present/);
    assert.match(text, /cache: degraded \(auto\)/);
    assert.match(text, /control-plane aws-account check/);
    assert.doesNotMatch(text, /super-secret-runtime-token/);
  });
});

test("deploy --operator-readiness does not require resolving selected secret token refs", async () => {
  await runInTemp("deploy-operator-readiness-secret-ref", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp, { deploymentContext: "demo-staging" });
    await writeJson(tmp, "projects/config/shared.json", {
      schemaVersion: "viberoots-project-config@1",
      controlPlanes: {
        prod: {
          serviceClient: {
            controlPlaneUrl: "https://control.prod.example",
            controlPlaneTokenRef: "secret://control-plane/demo-staging/service-token",
          },
        },
      },
      deploymentContexts: {
        "demo-staging": {
          controlPlane: "prod",
          secretBackend: "infisical/default",
          cloudflare: { account: "web-platform-staging", projectName: "demo-staging-pages" },
        },
      },
    });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-staging:deploy --operator-readiness`;
    const text = String(result.stdout);
    assert.match(text, /control-plane token: selected secret backend credential ref/);
    assert.match(
      text,
      /sprinkleref --update secret:\/\/control-plane\/demo-staging\/service-token --create-missing/,
    );
    assert.match(text, /control-plane aws-account config-init --domain <domain>/);
  });
});

async function writeAwsAccountEvidence(tmp: string) {
  await writeJson(tmp, "projects/config/control-plane/stack.json", {
    schemaVersion: "aws-account-stack-config@1",
    domain: "example.com",
    awsAccountId: "111122223333",
    awsOrganizationId: "o-example",
    supabaseOrgId: "supabase-org",
    supabaseProjectRef: "supabase-ref",
    supabaseAccessToken: { ref: "secret://control-plane/supabase/management-api-token" },
  });
  await writeJson(tmp, "buck-out/aws-account/control-example.com/status.json", {
    schemaVersion: "aws-account-status@1",
    updatedAt: "2026-06-11T00:00:00.000Z",
    stackName: "control",
    domain: "example.com",
    evidenceDir: "buck-out/aws-account/control-example.com",
    localOverrides: [],
    phases: {
      "check-tools": {
        state: "passed",
        message: "tools ok",
        cacheReadiness: {
          schemaVersion: "nix-cache-readiness@1",
          policy: "auto",
          state: "degraded",
          message: "optional fallback active",
          requiredSubstituters: ["https://cache.example.com/main"],
          optionalSubstituters: [],
          statuses: [],
        },
      },
      "check-aws-login": { state: "passed", message: "aws ok" },
      "check-supabase": { state: "blocked", message: "privatelink pending" },
      "bootstrap-state": { state: "pending", message: "not run" },
      "plan-foundation": { state: "pending", message: "not run" },
      "apply-foundation": { state: "pending", message: "not run" },
      "dns-migration": { state: "pending", message: "not run" },
      "verify-dns": { state: "pending", message: "not run" },
      "setup-profile": { state: "pending", message: "not run" },
      "validate-cutover": { state: "pending", message: "not run" },
      "remote-builds": { state: "pending", message: "not run" },
    },
    nextPhase: "check-supabase",
  });
}

async function writeJson(tmp: string, relativePath: string, value: unknown) {
  const filePath = path.join(tmp, relativePath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
