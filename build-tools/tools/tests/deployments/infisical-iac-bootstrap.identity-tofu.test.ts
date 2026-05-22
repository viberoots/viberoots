#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import {
  ensureBootstrapCredential,
  findIdentity,
} from "../../deployments/infisical-iac-bootstrap-identity";
import { buildPlanSummaryLines, runOpenTofu } from "../../deployments/infisical-iac-bootstrap-tofu";
import type {
  BootstrapArgs,
  CommandRunner,
  CredentialSink,
} from "../../deployments/infisical-iac-bootstrap-types";
import { reviewedMetadata } from "./infisical-iac-bootstrap.fixture";

class MemorySink implements CredentialSink {
  values = new Map<string, string>();
  describe() {
    return "memory sink";
  }
  async has(ref: string) {
    return this.values.has(ref);
  }
  async read(ref: string) {
    return this.values.get(ref);
  }
  async write(ref: string, value: string) {
    this.values.set(ref, value);
  }
}

test("bootstrap identity lookup rejects duplicate identity names", async () => {
  const api = {
    request: async () => ({
      identities: [
        { identity: { id: "id_1", name: "viberoots-iac-bootstrap" } },
        { identity: { id: "id_2", name: "viberoots-iac-bootstrap" } },
      ],
    }),
  };
  await assert.rejects(
    () => findIdentity(api as never, { ...DEFAULT_BOOTSTRAP_ARGS, organizationId: "org_1" }),
    /found 2 Infisical identities/,
  );
});

test("bootstrap credential creates current-machine secret when local secret is missing", async () => {
  const api = fakeCredentialApi({
    remoteSecrets: [{ id: "secret_other", description: "teammate laptop" }],
  });
  const sink = new MemorySink();
  const credential = await ensureBootstrapCredential({
    api: api as never,
    args: { ...DEFAULT_BOOTSTRAP_ARGS, machineLabel: "dev-laptop" },
    identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
    sink,
  });
  assert.equal(credential.status, "created");
  assert.equal(credential.remoteClientSecretRecords, 1);
  assert.deepEqual(credential.remoteClientSecretRecordSummaries, [
    { id: "secret_other", description: "teammate laptop", createdAt: undefined },
  ]);
  assert.equal(
    api.descriptions[0],
    "viberoots repo-bootstrap Universal Auth identity=viberoots-iac-bootstrap machine=dev-laptop",
  );
});

test("bootstrap credential rotation creates and stores a new client secret", async () => {
  const sink = new MemorySink();
  const api = fakeCredentialApi({ remoteSecrets: [{}], clientSecret: "new-secret" });
  const credential = await ensureBootstrapCredential({
    api: api as never,
    args: { ...DEFAULT_BOOTSTRAP_ARGS, rotateBootstrapCredentials: true },
    identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
    sink,
  });
  assert.equal(credential.clientId, "client-id");
  assert.equal(credential.clientSecret, "new-secret");
  assert.equal(credential.status, "rotated");
  assert.equal(
    sink.values.get("secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id"),
    "client-id",
  );
  assert.equal(
    sink.values.get("secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret"),
    "new-secret",
  );
});

test("bootstrap credential preserve mode reads the existing local secret", async () => {
  const sink = new MemorySink();
  sink.values.set(
    "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret",
    "old-secret",
  );
  const credential = await ensureBootstrapCredential({
    api: fakeCredentialApi({ remoteSecrets: [{}] }) as never,
    args: DEFAULT_BOOTSTRAP_ARGS,
    identity: { id: "id_1", name: "viberoots-iac-bootstrap" },
    sink,
  });
  assert.equal(credential.clientSecret, "old-secret");
  assert.equal(credential.status, "reused");
});

test("OpenTofu default path runs init, saved plan, and saved-plan apply", async () => {
  const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  const runner: CommandRunner = (call) => {
    calls.push(call);
    return "";
  };
  const args: BootstrapArgs & { organizationId: string } = {
    ...DEFAULT_BOOTSTRAP_ARGS,
    organizationId: "org_1",
    tofuPlanFile: ".local/test.tfplan",
  };
  await runOpenTofu({
    args,
    credential: {
      clientId: "id",
      clientSecret: "secret",
      status: "reused",
      remoteClientSecretRecords: 0,
      remoteClientSecretRecordSummaries: [],
    },
    reviewedMetadata,
    runner,
    confirmApply: async () => true,
  });
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ["init", "plan", "apply"],
  );
  assert.equal(calls[1].args[1], `${"-out="}${process.cwd()}/.local/test.tfplan`);
  assert.equal(calls[2].args[1], `${process.cwd()}/.local/test.tfplan`);
  assert.equal(calls[1].env?.INFISICAL_HOST, "https://app.infisical.com");
  assert.equal(calls[1].env?.TF_VAR_infisical_host, "https://app.infisical.com");
  assert.equal(calls[1].env?.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET, "secret");
  assert.equal(calls[1].env?.TF_VAR_project_slug, "pleomino-deployments");
  assert.equal(calls[1].env?.TF_VAR_secret_path, "/");
  assert.match(String(calls[1].env?.TF_VAR_machine_identity_names), /pleomino-staging-deploy/);
  assert.ok(!calls[1].args.join(" ").includes("secret"));
});

test("OpenTofu host override reaches provider inputs", async () => {
  const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];
  await runOpenTofu({
    args: {
      ...DEFAULT_BOOTSTRAP_ARGS,
      apiUrl: "https://eu.infisical.com",
      hostOverride: true,
      organizationId: "org_1",
      tofuPlanFile: ".local/test.tfplan",
      noTofuApply: true,
    },
    credential: {
      clientId: "id",
      clientSecret: "secret",
      status: "reused",
      remoteClientSecretRecords: 0,
      remoteClientSecretRecordSummaries: [],
    },
    reviewedMetadata,
    runner: (call) => {
      calls.push(call);
      return "";
    },
  });
  assert.equal(calls[1].env?.INFISICAL_HOST, "https://eu.infisical.com");
  assert.equal(calls[1].env?.TF_VAR_infisical_host, "https://eu.infisical.com");
});

test("OpenTofu apply prompt cancellation stops before apply", async () => {
  const calls: string[] = [];
  await assert.rejects(
    () =>
      runOpenTofu({
        args: {
          ...DEFAULT_BOOTSTRAP_ARGS,
          organizationId: "org_1",
          tofuPlanFile: ".local/test.tfplan",
        },
        credential: {
          clientId: "id",
          clientSecret: "secret",
          status: "reused",
          remoteClientSecretRecords: 0,
          remoteClientSecretRecordSummaries: [],
        },
        reviewedMetadata,
        runner: (call) => {
          calls.push(call.args[0]);
          return "";
        },
        confirmApply: async () => false,
      }),
    /apply cancelled/,
  );
  assert.deepEqual(calls, ["init", "plan"]);
});

test("OpenTofu plan summary remains non-secret", () => {
  const text = buildPlanSummaryLines("/tmp/tofu", "/tmp/plan.tfplan", false).join("\n");
  assert.match(text, /saved plan/);
  assert.doesNotMatch(text, /generated-secret|access-token|human-token/);
});

test("--no-tofu-apply stops after the saved plan", async () => {
  const calls: string[] = [];
  await runOpenTofu({
    args: {
      ...DEFAULT_BOOTSTRAP_ARGS,
      organizationId: "org_1",
      tofuPlanFile: ".local/test.tfplan",
      noTofuApply: true,
    },
    credential: {
      clientId: "id",
      clientSecret: "secret",
      status: "reused",
      remoteClientSecretRecords: 0,
      remoteClientSecretRecordSummaries: [],
    },
    reviewedMetadata,
    runner: (call) => {
      calls.push(call.args[0]);
      return "";
    },
  });
  assert.deepEqual(calls, ["init", "plan"]);
});

function fakeCredentialApi(opts: { remoteSecrets: unknown[]; clientSecret?: string }) {
  return {
    descriptions: [] as string[],
    request: async function (method: string, endpoint: string, body?: { description?: string }) {
      if (endpoint.endsWith("/client-secrets") && method === "GET")
        return { clientSecrets: opts.remoteSecrets };
      if (endpoint.endsWith("/client-secrets") && method === "POST") {
        this.descriptions.push(body?.description || "");
        return { clientSecret: opts.clientSecret ?? "new-secret" };
      }
      return { identityUniversalAuth: { clientId: "client-id" } };
    },
  };
}
