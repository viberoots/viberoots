#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DEFAULT_BOOTSTRAP_ARGS } from "../../deployments/infisical-iac-bootstrap-config";
import { runRepoBootstrap } from "../../deployments/infisical-iac-bootstrap-repo";
import type { MetadataHandoffPatch } from "../../deployments/infisical-iac-bootstrap-metadata-handoff";
import type { SharedInfisicalSession } from "../../deployments/infisical-iac-bootstrap-repo-credential";

const staging = "//projects/deployments/pleomino/staging:deploy";

test("repo bootstrap applies first-bootstrap metadata, resumes fan-out, and runs final checks", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-repo-flow-"));
  await writeRepoInputs(dir);
  const finalChecks: string[][] = [];
  const seenTargets: string[] = [];
  const credentialSetups: string[] = [];
  await withCwd(dir, () =>
    runRepoBootstrap(
      {
        ...DEFAULT_BOOTSTRAP_ARGS,
        yes: true,
        applyMetadataPatch: true,
        credentialSink: "local-file",
        localCredentialFile: ".local/bootstrap.json",
      },
      async (args) => {
        seenTargets.push(args.target || "");
        if (seenTargets.length === 1) {
          return { reconciliation: { status: "metadata_handoff_required", patch } };
        }
        return { reconciliation: { status: "ok" } };
      },
      {
        finalCheckRunner: async (argv) => (finalChecks.push(argv), 0),
        repoCredentialFactory: async (args) => {
          credentialSetups.push(args.identityName);
          return fixtureSession();
        },
      },
    ),
  );
  assert.deepEqual(seenTargets, [staging, staging]);
  assert.deepEqual(credentialSetups, ["viberoots-iac-bootstrap"]);
  const sharedConfig = path.join(dir, "projects/config/shared.json");
  assert.deepEqual(finalChecks, [
    ["--check", "--config", sharedConfig],
    ["--check", "--category", "bootstrap", "--config", sharedConfig],
  ]);
  assert.match(await fs.readFile(path.join(dir, patch.path), "utf8"), /proj_live/);
  assert.equal(await fs.readFile(path.join(dir, ".local/bootstrap.json"), "utf8"), "{}\n");
  assert.match(
    await fs.readFile(path.join(dir, "projects/config/shared.json"), "utf8"),
    /infisical-default/,
  );
});

async function writeRepoInputs(dir: string) {
  await fs.mkdir(path.join(dir, "build-tools/tools/buck"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "build-tools/tools/buck/graph.json"),
    `${JSON.stringify({ nodes: [deploymentNode()] }, null, 2)}\n`,
  );
  await fs.mkdir(path.join(dir, "projects/config"), { recursive: true });
  await fs.writeFile(
    path.join(dir, patch.path),
    `${JSON.stringify(
      {
        schemaVersion: "viberoots-project-config@1",
        deploymentContexts: {
          "pleomino-staging": { infisical: { projectId: "proj_old" } },
        },
        sprinkleref: {
          version: 1,
          defaultCategory: "main",
          profiles: {
            "infisical-default": {
              backend: "infisical",
              host: "https://app.infisical.com",
              projectId: "proj_old",
              defaultEnvironment: "staging",
              clientIdRef: "secret://bootstrap/client-id",
              clientSecretRef: "secret://bootstrap/client-secret",
            },
          },
          categories: {
            main: { profile: "infisical-default" },
            bootstrap: { backend: "local-file", file: ".local/bootstrap.json" },
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

function deploymentNode() {
  return {
    name: staging,
    rule_type: "deployment_target",
    deployment_family: "pleomino",
    environment_stage: "staging",
    secret_backend: "infisical/default",
    infisical_runtime: { project_id: "proj_old", environment: "staging" },
  };
}

function fixtureSession(): SharedInfisicalSession {
  return {
    apiUrl: "https://app.infisical.com",
    organizationId: "org_fixture",
    identity: { id: "identity_fixture", name: "viberoots-iac-bootstrap" },
    api: { request: fixtureRequest } as SharedInfisicalSession["api"],
    bootstrapCredential: {
      clientId: "client_fixture",
      clientSecret: "secret_fixture",
      status: "reused",
      remoteClientSecretRecords: 0,
      remoteClientSecretRecordSummaries: [],
    },
  };
}

async function fixtureRequest(method: string, endpoint: string) {
  if (method === "GET" && endpoint.startsWith("/api/v1/projects?")) {
    return { projects: [{ id: "proj_old", name: "viberoots-deployments", orgId: "org_fixture" }] };
  }
  if (method === "POST" && endpoint === "/api/v1/projects") {
    return { project: { id: "proj_repo_fixture", name: "viberoots-deployments" } };
  }
  if (endpoint.includes("/memberships/identities/")) {
    return method === "GET" ? undefined : { ok: true };
  }
  throw new Error(`unexpected Infisical fixture request: ${method} ${endpoint}`);
}

async function withCwd<T>(dir: string, run: () => Promise<T>) {
  const cwd = process.cwd();
  const oldWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const oldLiveRoot = process.env.LIVE_ROOT;
  process.chdir(dir);
  process.env.WORKSPACE_ROOT = dir;
  process.env.LIVE_ROOT = dir;
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    if (oldWorkspaceRoot === undefined) delete process.env.WORKSPACE_ROOT;
    else process.env.WORKSPACE_ROOT = oldWorkspaceRoot;
    if (oldLiveRoot === undefined) delete process.env.LIVE_ROOT;
    else process.env.LIVE_ROOT = oldLiveRoot;
  }
}

const patch: MetadataHandoffPatch = {
  schemaVersion: "infisical-iac-bootstrap-metadata-patch@1",
  path: "projects/config/shared.json",
  replacements: [
    {
      label: "deploymentContexts.pleomino-staging.infisical.projectId",
      before: "proj_old",
      after: "proj_live",
    },
  ],
  unifiedDiff: "--- a/projects/config/shared.json\n+proj_live\n",
};
