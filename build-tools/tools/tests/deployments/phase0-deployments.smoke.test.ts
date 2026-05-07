#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractDeployments } from "../../deployments/contract-extract";
import { DEPLOYMENT_CQUERY_ATTRS } from "../../deployments/deployment-query-attrs";
import { inheritedBuckIsolation } from "../lib/test-helpers";

const DEPLOYMENT_LABELS = [
  "//projects/deployments/platform-foundation-dev:deploy",
  "//projects/deployments/platform-foundation-staging:deploy",
  "//projects/deployments/platform-foundation-prod:deploy",
  "//projects/deployments/data-room-console-dev:deploy",
  "//projects/deployments/data-room-console-staging:deploy",
  "//projects/deployments/data-room-console-prod:deploy",
  "//projects/deployments/data-room-web-dev:deploy",
  "//projects/deployments/data-room-web-staging:deploy",
  "//projects/deployments/data-room-web-prod:deploy",
  "//projects/deployments/data-room-worker-dev:deploy",
  "//projects/deployments/data-room-worker-staging:deploy",
  "//projects/deployments/data-room-worker-prod:deploy",
];

async function extractPhase0SmokeDeployments() {
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const query = `deps(set(${DEPLOYMENT_LABELS.join(" ")}), 2)`;
  const cquery = await $({
    env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
  })`buck2 --isolation-dir ${inheritedBuckIsolation("phase0-smoke")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`;
  const { deployments, errors } = extractDeployments(
    nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "{}"))),
  );
  assert.deepEqual(errors, []);
  return new Map(deployments.map((deployment) => [deployment.deploymentId, deployment]));
}

test("Phase 0 smoke checks preserve declared runner, URL, path, and status", async () => {
  const deployments = await extractPhase0SmokeDeployments();
  for (const stage of ["dev", "staging", "prod"]) {
    const suffix = stage === "prod" ? "" : `.${stage}`;
    for (const [id, runnerClass, url, smokePath] of [
      [
        `data-room-console-${stage}`,
        "http_10m",
        `https://console${suffix}.data-room.example.invalid`,
        "/",
      ],
      [
        `data-room-web-${stage}`,
        "http_10m",
        `https://web${suffix}.data-room.example.invalid`,
        "/healthz",
      ],
      [
        `data-room-worker-${stage}`,
        "service_health_10m",
        `service://data-room-worker-${stage}`,
        "/healthz",
      ],
    ]) {
      const smoke = deployments.get(id)?.smoke;
      assert.deepEqual(
        {
          runner: smoke?.runner,
          runnerClass: smoke?.runnerClass,
          url: smoke?.url,
          path: smoke?.path,
          expectedStatus: smoke?.expectedStatus,
        },
        { runner: "http", runnerClass, url, path: smokePath, expectedStatus: "200" },
      );
    }
  }
});
