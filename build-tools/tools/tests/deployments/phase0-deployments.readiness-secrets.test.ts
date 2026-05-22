#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { readReadinessGatePolicies } from "../../deployments/deployment-readiness-gates";
import { readDeploymentRequirements } from "../../deployments/deployment-requirements";

const READINESS_CONTRACTS = [
  "connect-readiness",
  "github-readiness",
  "ragie-readiness",
  "tenant-leak-readiness",
  "workos-mcp-readiness",
].map((name) => `secret://deployments/fixture/readiness/${name}`);

function readinessNode() {
  return {
    name: "//fixture/deployments/app-prod:deploy",
    readiness_gates: READINESS_CONTRACTS.map((contractId) => ({
      name: contractId.split("/").at(-1),
      type: "ragie_acl_semantics",
      required_for: "deploy,provision_only",
      gate_version: "fixture-2026-05",
      credential_source: "secret_runtime",
      secret_runtime_step: "readiness",
      credential_contract_id: contractId,
    })),
    secret_requirements: READINESS_CONTRACTS.map((contractId) => ({
      name: contractId.split("/").at(-1),
      step: "readiness",
      contract_id: contractId,
      required: true,
      source: "secret_runtime",
    })),
  };
}

test("readiness gates and secret requirements use reviewed secret runtime", () => {
  const node = readinessNode();
  const gateContracts = readReadinessGatePolicies(node).map((gate) => {
    assert.equal(gate.credentialSource, "secret_runtime", gate.name);
    assert.equal(gate.secretRuntimeStep, "readiness", gate.name);
    return gate.credentialContractId;
  });
  const declaredContracts = readDeploymentRequirements(node, "secret_requirements").map(
    (requirement) => {
      assert.equal(requirement.source, "secret_runtime", requirement.name);
      assert.equal(requirement.step, "readiness", requirement.name);
      return requirement.contractId;
    },
  );
  assert.deepEqual(declaredContracts.sort(), READINESS_CONTRACTS);
  assert.deepEqual(gateContracts.sort(), READINESS_CONTRACTS);
});
