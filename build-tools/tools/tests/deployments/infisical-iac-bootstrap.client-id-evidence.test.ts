#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureBootstrapCredential } from "../../deployments/infisical-iac-bootstrap-identity";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { ensureDeploymentCredentials } from "../../deployments/infisical-iac-deployment-credentials";
import type { CredentialSink } from "../../deployments/infisical-iac-bootstrap-types";
import { reviewedMetadata } from "./infisical-iac-bootstrap.fixture";

class MemorySink implements CredentialSink {
  async has() {
    return false;
  }
  async read() {
    return undefined;
  }
  async write() {}
  describe() {
    return "memory sink";
  }
}

test("repo bootstrap credential fails when Universal Auth client id is missing", async () => {
  await assert.rejects(
    () =>
      ensureBootstrapCredential({
        api: missingClientIdApi() as never,
        args: DEFAULT_BOOTSTRAP_ARGS,
        identity: { id: "identity_repo", name: "viberoots-iac-bootstrap" },
        sink: new MemorySink(),
      }),
    /Universal Auth retrieve response did not include clientId/,
  );
});

test("deployment credential setup fails when Universal Auth client id is missing", async () => {
  await assert.rejects(
    () =>
      ensureDeploymentCredentials({
        api: missingClientIdApi() as never,
        args: DEFAULT_BOOTSTRAP_ARGS,
        sink: new MemorySink(),
        metadata: {
          ...reviewedMetadata,
          deploymentCredentials: reviewedMetadata.deploymentCredentials.slice(0, 1),
        },
      }),
    /Universal Auth retrieve response did not include clientId/,
  );
});

function missingClientIdApi() {
  return {
    request(method: string, endpoint: string) {
      if (method === "GET" && endpoint.includes("/auth/universal-auth/identities/")) {
        return { identityUniversalAuth: {} };
      }
      throw new Error(`unexpected Infisical fixture request: ${method} ${endpoint}`);
    },
  };
}
