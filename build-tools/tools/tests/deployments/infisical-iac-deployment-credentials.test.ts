#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureDeploymentCredentials } from "../../deployments/infisical-iac-deployment-credentials";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import type { CredentialSink } from "../../deployments/infisical-iac-bootstrap-types";
import { reviewedMetadata } from "./infisical-iac-bootstrap.fixture";

class MemorySink implements CredentialSink {
  values = new Map<string, string>();
  describe() {
    return "memory bootstrap category";
  }
  async has(ref: string) {
    return this.values.has(ref);
  }
  async read(ref: string) {
    return this.values.get(ref);
  }
  async write(ref: string, value: string, overwrite: boolean) {
    if (this.values.has(ref) && !overwrite) throw new Error(`existing ${ref}`);
    this.values.set(ref, value);
  }
}

class OverlapDetectingSink extends MemorySink {
  private writing = false;

  async write(ref: string, value: string, overwrite: boolean) {
    if (this.writing) throw new Error(`overlapping write for ${ref}`);
    this.writing = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await super.write(ref, value, overwrite);
    } finally {
      this.writing = false;
    }
  }
}

test("deployment credentials preserve existing remote and bootstrap category values", async () => {
  const sink = deploymentSink({
    "secret://deployments/pleomino/staging/infisical-client-secret": "existing-secret",
  });
  const api = fakeDeploymentCredentialApi({
    remoteSecrets: { staging: [{ id: "secret_other", description: "teammate laptop" }] },
  });
  const result = await ensureDeploymentCredentials({
    api: api as never,
    args: DEFAULT_BOOTSTRAP_ARGS,
    sink,
    metadata: oneStageMetadata("staging"),
  });
  assert.equal(result[0]?.status, "reused");
  assert.equal(api.postCount, 0);
  assert.equal(
    sink.values.get("secret://deployments/pleomino/staging/infisical-client-id"),
    "client-id-staging",
  );
});

test("deployment credentials create current-machine secret when local value is missing", async () => {
  const api = fakeDeploymentCredentialApi({
    remoteSecrets: { staging: [{ id: "secret_other", description: "teammate laptop" }] },
  });
  const result = await ensureDeploymentCredentials({
    api: api as never,
    args: { ...DEFAULT_BOOTSTRAP_ARGS, machineLabel: "dev-laptop" },
    sink: new MemorySink(),
    metadata: oneStageMetadata("staging"),
  });
  assert.equal(result[0]?.status, "created");
  assert.equal(result[0]?.remoteClientSecretRecords, 1);
  assert.deepEqual(result[0]?.remoteClientSecretRecordSummaries, [
    { id: "secret_other", description: "teammate laptop", createdAt: undefined },
  ]);
  assert.equal(api.postCount, 1);
  assert.equal(
    api.descriptions[0],
    "viberoots deployment staging Universal Auth identity=pleomino-staging-deploy machine=dev-laptop",
  );
});

test("deployment credential preserve mode refuses client id overwrite even with force", async () => {
  const clientIdRef = "secret://deployments/pleomino/staging/infisical-client-id";
  const sink = deploymentSink({
    [clientIdRef]: "old-client-id",
    "secret://deployments/pleomino/staging/infisical-client-secret": "existing-secret",
  });
  const api = fakeDeploymentCredentialApi({ remoteSecrets: { staging: [{}] } });
  await assert.rejects(
    () =>
      ensureDeploymentCredentials({
        api: api as never,
        args: { ...DEFAULT_BOOTSTRAP_ARGS, forceOverwriteLocalCredentials: true },
        sink,
        metadata: oneStageMetadata("staging"),
      }),
    /may be replaced only when a new remote credential is created/,
  );
  assert.equal(api.postCount, 0);
  assert.equal(sink.values.get(clientIdRef), "old-client-id");
});

test("deployment credential rotation creates remote secret and overwrites selected sink", async () => {
  const sink = deploymentSink({
    "secret://deployments/pleomino/prod/infisical-client-id": "old-id",
    "secret://deployments/pleomino/prod/infisical-client-secret": "old-secret",
  });
  const api = fakeDeploymentCredentialApi({
    remoteSecrets: { prod: [{}] },
    createdSecret: "new-secret",
  });
  const result = await ensureDeploymentCredentials({
    api: api as never,
    args: {
      ...DEFAULT_BOOTSTRAP_ARGS,
      rotateDeploymentCredentials: true,
      forceOverwriteLocalCredentials: true,
    },
    sink,
    metadata: oneStageMetadata("prod"),
  });
  assert.equal(result[0]?.status, "rotated");
  assert.equal(api.postCount, 1);
  assert.equal(
    sink.values.get("secret://deployments/pleomino/prod/infisical-client-id"),
    "client-id-prod",
  );
  assert.equal(
    sink.values.get("secret://deployments/pleomino/prod/infisical-client-secret"),
    "new-secret",
  );
});

test("deployment credentials write staging and prod serially into one sink", async () => {
  const sink = new OverlapDetectingSink();
  const api = fakeDeploymentCredentialApi({ remoteSecrets: { staging: [], prod: [] } });
  const result = await ensureDeploymentCredentials({
    api: api as never,
    args: DEFAULT_BOOTSTRAP_ARGS,
    sink,
    metadata: reviewedMetadata,
  });
  assert.deepEqual(
    result.map((item) => [item.stage, item.status]),
    [
      ["staging", "created"],
      ["prod", "created"],
    ],
  );
  assert.equal(
    sink.values.get("secret://deployments/pleomino/staging/infisical-client-id"),
    "client-id-staging",
  );
  assert.equal(
    sink.values.get("secret://deployments/pleomino/staging/infisical-client-secret"),
    "new-secret-staging",
  );
  assert.equal(
    sink.values.get("secret://deployments/pleomino/prod/infisical-client-id"),
    "client-id-prod",
  );
  assert.equal(
    sink.values.get("secret://deployments/pleomino/prod/infisical-client-secret"),
    "new-secret-prod",
  );
});

test("deployment credentials reuse local secret without remote records", async () => {
  const sink = deploymentSink({
    "secret://deployments/pleomino/staging/infisical-client-secret": "existing-secret",
  });
  const api = fakeDeploymentCredentialApi({ remoteSecrets: { staging: [] } });
  const result = await ensureDeploymentCredentials({
    api: api as never,
    args: DEFAULT_BOOTSTRAP_ARGS,
    sink,
    metadata: oneStageMetadata("staging"),
  });
  assert.equal(result[0]?.status, "reused");
  assert.equal(api.postCount, 0);
});

test("deployment credentials reuse local secret when force is set without rotation", async () => {
  const sink = deploymentSink({
    "secret://deployments/pleomino/staging/infisical-client-secret": "existing-secret",
  });
  const api = fakeDeploymentCredentialApi({ remoteSecrets: { staging: [] } });
  const result = await ensureDeploymentCredentials({
    api: api as never,
    args: { ...DEFAULT_BOOTSTRAP_ARGS, forceOverwriteLocalCredentials: true },
    sink,
    metadata: oneStageMetadata("staging"),
  });
  assert.equal(result[0]?.status, "reused");
  assert.equal(api.postCount, 0);
  assert.equal(
    sink.values.get("secret://deployments/pleomino/staging/infisical-client-secret"),
    "existing-secret",
  );
});

function deploymentSink(values: Record<string, string>) {
  const sink = new MemorySink();
  for (const [ref, value] of Object.entries(values)) sink.values.set(ref, value);
  return sink;
}

function oneStageMetadata(stage: "staging" | "prod") {
  return {
    ...reviewedMetadata,
    deploymentCredentials: reviewedMetadata.deploymentCredentials.filter(
      (item) => item.stage === stage,
    ),
  };
}

function fakeDeploymentCredentialApi(opts: {
  remoteSecrets: Record<string, unknown[]>;
  createdSecret?: string;
}) {
  const stageByIdentityId = new Map(
    reviewedMetadata.deploymentCredentials.map((item) => [item.identityId, item.stage]),
  );
  return {
    postCount: 0,
    descriptions: [] as string[],
    request(method: string, endpoint: string, body?: { description?: string }) {
      const stage =
        [...stageByIdentityId.entries()].find(([identityId]) =>
          endpoint.includes(identityId),
        )?.[1] || (endpoint.includes("staging") ? "staging" : "prod");
      if (endpoint.endsWith("/client-secrets") && method === "GET")
        return { clientSecrets: opts.remoteSecrets[stage] ?? [] };
      if (endpoint.endsWith("/client-secrets") && method === "POST") {
        this.postCount += 1;
        this.descriptions.push(body?.description || "");
        return { clientSecret: opts.createdSecret ?? `new-secret-${stage}` };
      }
      return { identityUniversalAuth: { clientId: `client-id-${stage}` } };
    },
  };
}
