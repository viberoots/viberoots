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
import { ensureDeploymentCredentials } from "../../deployments/infisical-iac-deployment-credentials";
import type { SharedInfisicalSession } from "../../deployments/infisical-iac-bootstrap-repo-credential";
import type { CredentialSink } from "../../deployments/infisical-iac-bootstrap-types";

test("repo fan-out reuses one operator session while creating per-machine secrets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-repo-credentials-"));
  await writeInputs(dir);
  const api = new CredentialLifecycleApi();
  const sink = new MemorySink();
  let session: SharedInfisicalSession | undefined;
  const statuses: Array<[string, string]> = [];
  await withCwd(dir, () =>
    runRepoBootstrap(
      {
        ...DEFAULT_BOOTSTRAP_ARGS,
        yes: true,
        machineLabel: "dev-laptop",
        credentialSink: "local-file",
        localCredentialFile: ".local/bootstrap.json",
      },
      async (args, context) => {
        assert.equal(context.infisicalSession, session);
        const result = await ensureDeploymentCredentials({
          api: context.infisicalSession!.api,
          args,
          sink,
          metadata: reviewedMetadataForTarget(args.target!),
        });
        statuses.push(...result.map((item) => [item.stage, item.status] as const));
        return { reconciliation: { status: "ok" } };
      },
      {
        finalCheckRunner: async () => 0,
        credentialSinkFactory: async () => sink,
        verifyUniversalAuth: async () => undefined,
        repoCredentialFactory: async (args) => {
          session = fixtureSession(api, {
            bootstrapCredential: await ensureBootstrapCredential({
              api: api as never,
              args,
              identity: repoIdentity,
              sink,
            }),
          });
          return session;
        },
      },
    ),
  );
  assert.deepEqual(
    statuses.sort(([left], [right]) => left.localeCompare(right)),
    [
      ["prod", "created"],
      ["staging", "created"],
    ],
  );
  assert.equal(
    api.createdSecretDescriptions[0],
    "viberoots repo-bootstrap Universal Auth identity=viberoots-iac-bootstrap machine=dev-laptop",
  );
  assert.deepEqual(api.createdSecretDescriptions.slice(1).sort(), [
    "viberoots deployment prod Universal Auth identity=sample-webapp-prod-deploy machine=dev-laptop",
    "viberoots deployment staging Universal Auth identity=sample-webapp-staging-deploy machine=dev-laptop",
  ]);
});

async function writeInputs(dir: string) {
  await fs.mkdir(path.join(dir, ".viberoots/workspace/buck"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".viberoots/workspace/buck/graph.json"),
    `${JSON.stringify({ nodes: ["staging", "prod"].map(deploymentNode) }, null, 2)}\n`,
  );
  await fs.mkdir(path.join(dir, "projects/deployments/sample-webapp/shared"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "projects/deployments/sample-webapp/shared/family.bzl"),
    metadataSource,
  );
}

function deploymentNode(stage: string) {
  return {
    name: `//projects/deployments/sample-webapp/${stage}:deploy`,
    rule_type: "deployment_target",
    deployment_family: "sample-webapp",
    environment_stage: stage,
    secret_backend: "infisical/default",
    infisical_runtime: { project_id: "proj_fixture", environment: stage },
  };
}

function fixtureSession(
  api: SharedInfisicalSession["api"],
  extra: Pick<SharedInfisicalSession, "bootstrapCredential">,
): SharedInfisicalSession {
  return {
    apiUrl: "https://app.infisical.com",
    organizationId: "org_fixture",
    identity: repoIdentity,
    api,
    ...extra,
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

const repoIdentity = { id: "identity_repo", name: "viberoots-iac-bootstrap" };

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

class CredentialLifecycleApi {
  createdSecretDescriptions: string[] = [];
  private readonly projects: Array<{ id: string; name: string; orgId: string }> = [];

  async request(method: string, endpoint: string, body?: { description?: string }) {
    if (method === "GET" && endpoint.startsWith("/api/v1/projects?")) {
      return { projects: this.projects };
    }
    if (method === "POST" && endpoint === "/api/v1/projects") {
      const project = { id: "proj_fixture", name: "viberoots-deployments", orgId: "org_fixture" };
      this.projects.push(project);
      return { project };
    }
    if (endpoint.includes("/memberships/identities/")) {
      return method === "GET" ? undefined : { ok: true };
    }
    if (method === "GET" && endpoint.endsWith("/client-secrets")) return { clientSecrets: [] };
    if (method === "POST" && endpoint.endsWith("/client-secrets")) {
      this.createdSecretDescriptions.push(body?.description || "");
      return { clientSecret: `secret-${this.createdSecretDescriptions.length}` };
    }
    if (method === "GET" && endpoint.includes("/auth/universal-auth/identities/")) {
      return { identityUniversalAuth: { clientId: clientIdForEndpoint(endpoint) } };
    }
    throw new Error(`unexpected Infisical fixture request: ${method} ${endpoint}`);
  }
}

function clientIdForEndpoint(endpoint: string) {
  const match = Object.entries(identityClientIds).find(([identityId]) =>
    endpoint.includes(identityId),
  );
  if (!match) throw new Error(`unexpected identity endpoint: ${endpoint}`);
  return match[1];
}

function reviewedMetadataForTarget(target: string) {
  const stage = target.includes("/prod:") ? "prod" : "staging";
  const metadata = parseDeploymentReviewedMetadata(metadataSource);
  return {
    ...metadata,
    deploymentCredentials: metadata.deploymentCredentials.filter((item) => item.stage === stage),
  };
}

const identityClientIds = {
  identity_repo: "client_repo",
  "ae854a19-3537-4d40-8730-8314a74c3d04": "client_staging",
  "5e302d6c-3ac7-4fbc-a75f-b2312f33809a": "client_prod",
};

const metadataSource = `
_INFISICAL_SITE_URL = "https://app.infisical.com"
_INFISICAL_PROJECT_ID = "proj_fixture"
_INFISICAL_PROJECT_NAME = "sample-webapp-deployments"
_INFISICAL_PROJECT_SLUG = "sample-webapp-deployments"
_INFISICAL_SECRET_PATH = "/"
_INFISICAL_CLOUDFLARE_SECRET_NAME = "cloudflare_api_token"
_INFISICAL_ENVIRONMENT_SLUGS = {"staging": "staging", "prod": "prod"}
_INFISICAL_MACHINE_IDENTITY_IDS = {
    "staging": "ae854a19-3537-4d40-8730-8314a74c3d04",
    "prod": "5e302d6c-3ac7-4fbc-a75f-b2312f33809a",
}
_INFISICAL_MACHINE_IDENTITY_NAMES = {
    "staging": "sample-webapp-staging-deploy",
    "prod": "sample-webapp-prod-deploy",
}
_INFISICAL_CREDENTIAL_FILE_NAMES = {
    "staging": {
        "client_id": "sample-webapp-staging-infisical-client-id",
        "client_secret": "sample-webapp-staging-infisical-client-secret",
    },
    "prod": {
        "client_id": "sample-webapp-prod-infisical-client-id",
        "client_secret": "sample-webapp-prod-infisical-client-secret",
    },
}
_INFISICAL_CREDENTIAL_REFS = {
    "staging": {
        "client_id": "secret://deployments/sample-webapp/staging/infisical-client-id",
        "client_secret": "secret://deployments/sample-webapp/staging/infisical-client-secret",
    },
    "prod": {
        "client_id": "secret://deployments/sample-webapp/prod/infisical-client-id",
        "client_secret": "secret://deployments/sample-webapp/prod/infisical-client-secret",
    },
}
`;
