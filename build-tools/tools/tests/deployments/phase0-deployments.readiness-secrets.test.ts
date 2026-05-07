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

const READINESS_CONTRACTS = [
  "connect-readiness",
  "github-readiness",
  "ragie-readiness",
  "tenant-leak-readiness",
  "workos-mcp-readiness",
].map((name) => `secret://deployments/phase0/readiness/${name}`);

async function queryPhase0Deployments() {
  const attrFlags = DEPLOYMENT_CQUERY_ATTRS.flatMap((attr) => ["--output-attribute", attr]);
  const query = `deps(set(${DEPLOYMENT_LABELS.join(" ")}), 2)`;
  const cquery = await $({
    env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
  })`buck2 --isolation-dir ${inheritedBuckIsolation("phase0-readiness-secrets")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`;
  const { deployments, errors } = extractDeployments(
    nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "{}"))),
  );
  assert.deepEqual(errors, []);
  return deployments;
}

test("Phase 0 readiness gates and secret requirements use reviewed secret runtime", async () => {
  for (const deployment of await queryPhase0Deployments()) {
    const gateContracts = (deployment.admissionPolicy.readinessGates || []).map((gate) => {
      assert.equal(gate.credentialSource, "secret_runtime", gate.name);
      assert.equal(gate.secretRuntimeStep, "readiness", gate.name);
      assert.ok(gate.credentialContractId?.startsWith("secret://deployments/phase0/readiness/"));
      return gate.credentialContractId;
    });
    const declaredContracts = deployment.secretRequirements
      .filter((requirement) => requirement.step === "readiness")
      .map((requirement) => {
        assert.equal(requirement.source, "secret_runtime", requirement.name);
        return requirement.contractId;
      })
      .sort();
    assert.deepEqual(declaredContracts, READINESS_CONTRACTS, deployment.label);
    assert.deepEqual([...new Set(gateContracts)].sort(), READINESS_CONTRACTS, deployment.label);
  }
});
