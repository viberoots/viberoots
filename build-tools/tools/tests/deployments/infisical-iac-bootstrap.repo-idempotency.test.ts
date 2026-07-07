#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { ensureBootstrapCredential } from "../../deployments/infisical-iac-bootstrap-identity";
import { parseDeploymentReviewedMetadata } from "../../deployments/infisical-iac-bootstrap-reviewed-metadata";
import { runRepoBootstrap } from "../../deployments/infisical-iac-bootstrap-repo";
import type { SharedInfisicalSession } from "../../deployments/infisical-iac-bootstrap-repo-credential";
import type { CredentialSink } from "../../deployments/infisical-iac-bootstrap-types";
import { ensureDeploymentCredentials } from "../../deployments/infisical-iac-deployment-credentials";

test("repeated repo setup reuses current-machine credentials and leaves other machines", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-repo-idempotency-"));
  await writeInputs(dir);
  const api = new CredentialApi();
  const sink = new MemorySink();
  const first = await runSetup(dir, api, sink);
  const createdAfterFirstRun = [...api.createdSecretDescriptions];
  const otherMachineRecords = api.otherMachineDescriptions();
  const second = await runSetup(dir, api, sink);

  assert.equal(first.bootstrapStatus, "created");
  assert.equal(second.bootstrapStatus, "reused");
  assert.deepEqual(statusesByStage(first.deploymentStatuses), [
    ["prod", "created"],
    ["staging", "created"],
  ]);
  assert.deepEqual(statusesByStage(second.deploymentStatuses), [
    ["prod", "reused"],
    ["staging", "reused"],
  ]);
  assert.deepEqual(api.createdSecretDescriptions, createdAfterFirstRun);
  assert.deepEqual(api.otherMachineDescriptions(), otherMachineRecords);
});

async function runSetup(dir: string, api: CredentialApi, sink: MemorySink) {
  let bootstrapStatus = "";
  const deploymentStatuses: Array<[string, string]> = [];
  await withCwd(dir, () =>
    runRepoBootstrap(
      args,
      async (deploymentArgs, context) => {
        const result = await ensureDeploymentCredentials({
          api: context.infisicalSession!.api,
          args: deploymentArgs,
          sink,
          metadata: metadataForTarget(deploymentArgs.target!),
        });
        deploymentStatuses.push(...result.map((item) => [item.stage, item.status] as const));
        return { reconciliation: { status: "ok" } };
      },
      {
        finalCheckRunner: async () => 0,
        credentialSinkFactory: async () => sink,
        verifyUniversalAuth: async () => undefined,
        repoCredentialFactory: async (repoArgs) => {
          const bootstrapCredential = await ensureBootstrapCredential({
            api: api as never,
            args: repoArgs,
            identity: repoIdentity,
            sink,
          });
          bootstrapStatus = bootstrapCredential.status;
          return session(api, bootstrapCredential);
        },
      },
    ),
  );
  return { bootstrapStatus, deploymentStatuses };
}

function statusesByStage(statuses: Array<[string, string]>) {
  return statuses.sort(([left], [right]) => left.localeCompare(right));
}

async function writeInputs(dir: string) {
  await fs.mkdir(path.join(dir, ".viberoots/workspace/buck"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".viberoots/workspace/buck/graph.json"),
    `${JSON.stringify({ nodes: ["staging", "prod"].map(node) })}\n`,
  );
  await fs.mkdir(path.join(dir, "projects/deployments/sample-webapp/shared"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "projects/deployments/sample-webapp/shared/family.bzl"),
    metadata,
  );
}

function node(stage: string) {
  return {
    name: `//projects/deployments/sample-webapp/${stage}:deploy`,
    rule_type: "deployment_target",
    deployment_family: "sample-webapp",
    environment_stage: stage,
    secret_backend: "infisical/default",
    infisical_runtime: { project_id: "proj_fixture", environment: stage },
  };
}

function metadataForTarget(target: string) {
  const stage = target.includes("/prod:") ? "prod" : "staging";
  const parsed = parseDeploymentReviewedMetadata(metadata);
  return {
    ...parsed,
    deploymentCredentials: parsed.deploymentCredentials.filter((item) => item.stage === stage),
  };
}

function session(
  api: SharedInfisicalSession["api"],
  bootstrapCredential: SharedInfisicalSession["bootstrapCredential"],
): SharedInfisicalSession {
  return {
    apiUrl: "https://app.infisical.com",
    organizationId: "org_fixture",
    identity: repoIdentity,
    api,
    bootstrapCredential,
  };
}

async function withCwd<T>(dir: string, run: () => Promise<T>) {
  const cwd = process.cwd();
  const oldWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const oldDevshellRoot = process.env._VIBEROOTS_DEVSHELL_ROOT;
  const oldLiveRoot = process.env.LIVE_ROOT;
  process.chdir(dir);
  process.env.WORKSPACE_ROOT = dir;
  process.env._VIBEROOTS_DEVSHELL_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    if (oldWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = oldWorkspaceRoot;
    if (oldDevshellRoot === undefined) delete process.env._VIBEROOTS_DEVSHELL_ROOT;
    else process.env._VIBEROOTS_DEVSHELL_ROOT = oldDevshellRoot;
    if (oldLiveRoot === undefined) delete process.env.LIVE_ROOT;
    else process.env.LIVE_ROOT = oldLiveRoot;
  }
}

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
  async write(ref: string, value: string, overwrite: boolean) {
    if (this.values.has(ref) && !overwrite) throw new Error(`existing ${ref}`);
    this.values.set(ref, value);
  }
}

class CredentialApi {
  createdSecretDescriptions: string[] = [];
  private readonly projects: Array<{ id: string; name: string; orgId: string }> = [];
  private readonly clientSecretsByIdentity = new Map(
    Object.keys(clientIds).map((id) => [id, [{ description: `other-machine ${id}` }]]),
  );

  async request(method: string, endpoint: string, body?: { description?: string }) {
    if (method === "GET" && endpoint.startsWith("/api/v1/projects?")) {
      return { projects: this.projects };
    }
    if (method === "POST" && endpoint === "/api/v1/projects") {
      const project = { id: "proj_fixture", name: "viberoots-deployments", orgId: "org_fixture" };
      this.projects.push(project);
      return { project };
    }
    if (endpoint.includes("/memberships/identities/")) return method === "GET" ? undefined : {};
    if (method === "GET" && endpoint.endsWith("/client-secrets")) {
      return { clientSecrets: this.recordsForEndpoint(endpoint) };
    }
    if (method === "POST" && endpoint.endsWith("/client-secrets")) {
      this.createdSecretDescriptions.push(body?.description || "");
      this.recordsForEndpoint(endpoint).push({ description: body?.description || "" });
      return { clientSecret: `secret-${this.createdSecretDescriptions.length}` };
    }
    if (method === "GET" && endpoint.includes("/auth/universal-auth/identities/")) {
      return { identityUniversalAuth: { clientId: clientIdForEndpoint(endpoint) } };
    }
    throw new Error(`unexpected Infisical fixture request: ${method} ${endpoint}`);
  }

  otherMachineDescriptions() {
    return [...this.clientSecretsByIdentity.values()].map((records) => records[0]?.description);
  }

  private recordsForEndpoint(endpoint: string) {
    const id = Object.keys(clientIds).find((identityId) => endpoint.includes(identityId));
    if (!id) throw new Error(`unexpected client secret endpoint: ${endpoint}`);
    return this.clientSecretsByIdentity.get(id)!;
  }
}

function clientIdForEndpoint(endpoint: string) {
  const match = Object.entries(clientIds).find(([id]) => endpoint.includes(id));
  if (!match) throw new Error(`unexpected identity endpoint: ${endpoint}`);
  return match[1];
}

const args = {
  ...DEFAULT_BOOTSTRAP_ARGS,
  yes: true,
  machineLabel: "dev-laptop",
  credentialSink: "local-file" as const,
  localCredentialFile: ".local/bootstrap.json",
};
const repoIdentity = { id: "identity_repo", name: "viberoots-iac-bootstrap" };
const clientIds = {
  identity_repo: "client_repo",
  "ae854a19-3537-4d40-8730-8314a74c3d04": "client_staging",
  "5e302d6c-3ac7-4fbc-a75f-b2312f33809a": "client_prod",
};
const metadata = `
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "proj_fixture"
_INFISICAL_PROJECT_NAME = "sample-webapp-deployments"
_INFISICAL_PROJECT_SLUG = "sample-webapp-deployments"
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging", "prod": "prod"}
_INFISICAL_MACHINE_IDENTITY_IDS = {"staging": "ae854a19-3537-4d40-8730-8314a74c3d04", "prod": "5e302d6c-3ac7-4fbc-a75f-b2312f33809a"}
_INFISICAL_MACHINE_IDENTITY_NAMES = {"staging": "sample-webapp-staging-deploy", "prod": "sample-webapp-prod-deploy"}
_INFISICAL_CREDENTIAL_FILE_NAMES = {"staging": {"client_id": "sid", "client_secret": "ssec"}, "prod": {"client_id": "pid", "client_secret": "psec"}}
_INFISICAL_CREDENTIAL_REFS = {"staging": {"client_id": "secret://deployments/sample-webapp/staging/infisical-client-id", "client_secret": "secret://deployments/sample-webapp/staging/infisical-client-secret"}, "prod": {"client_id": "secret://deployments/sample-webapp/prod/infisical-client-id", "client_secret": "secret://deployments/sample-webapp/prod/infisical-client-secret"}}
`;
