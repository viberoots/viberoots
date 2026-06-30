#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createDeploymentResourceInventory,
  readDeploymentResourceInventory,
} from "../../deployments/resource-graph-inventory";
import {
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
} from "../../lib/workspace-state-paths";
import {
  cloudflareDeployment,
  cloudflareNodes,
  withProjectConfig,
  writeJson,
} from "./deployment-contexts.scope.helpers";
import { viberootsRepoPath } from "./deployment-command";

function kinds(inventory: ReturnType<typeof createDeploymentResourceInventory>) {
  return new Set(inventory.resources.map((resource) => resource.kind));
}

test("resource inventory maps extracted deployment metadata and runtime facts", async () => {
  await withProjectConfig(
    {
      controlPlanes: {
        prod: {
          serviceClient: {
            controlPlaneUrl: "https://control.example",
            controlPlaneTokenRef: "secret://control/prod/token",
          },
        },
      },
      deploymentContexts: {
        "app-prod": {
          controlPlane: "prod",
          cloudflare: { account: "web-platform", projectName: "pleomino-prod" },
        },
      },
    },
    async () => {
      await writeJson("projects/config/local.json", {
        schemaVersion: "viberoots-project-config@1",
        controlPlanes: { prod: { serviceClient: { controlPlaneTokenRef: "secret://local" } } },
      });
      const inventory = createDeploymentResourceInventory(
        cloudflareNodes([
          cloudflareDeployment({
            deployment_context: "app-prod",
            secret_requirements: [
              {
                name: "api_token",
                step: "publish",
                contract_id: "secret://deployments/pleomino/api-token",
                required: "true",
              },
            ],
            runtime_config_requirements: [
              {
                name: "public_url",
                step: "publish",
                contract_id: "runtime://deployments/pleomino/public-url",
                required: "true",
              },
            ],
          }),
        ]),
        {
          runtimeSources: {
            executionSnapshots: [
              {
                id: "run-1:snapshot",
                facts: {
                  snapshotId: "run-1:snapshot",
                  deploymentId: "pleomino-staging",
                  capturedAt: "2026-01-01T00:00:00.000Z",
                },
              },
            ],
            deployRuns: [
              {
                id: "run-1",
                facts: { runId: "run-1", deploymentId: "pleomino-staging", status: "passed" },
              },
            ],
            currentStageStates: [
              {
                id: "pleomino-staging:staging",
                facts: {
                  deploymentId: "pleomino-staging",
                  stage: "staging",
                  state: "deployed",
                },
              },
            ],
            artifactChallenges: [
              {
                id: "challenge-1",
                facts: {
                  challengeId: "challenge-1",
                  deploymentId: "pleomino-staging",
                  proofKeyId: "key-1",
                  issuedAt: "2026-01-01T00:00:00.000Z",
                  nonceValidationOutcome: "matched-redacted-nonce-digest",
                  proofKeyValidationOutcome: "trusted-key",
                  oneTimeConsumption: "consumed-once",
                  admittedProvenance: "artifact-binding:binding-1",
                  status: "accepted",
                },
              },
            ],
            staticWebappUploadSessions: [
              {
                id: "upload-session:1",
                facts: {
                  uploadSessionId: "upload-session:1",
                  submissionId: "submission-1",
                  archiveFormat: "tar.gz",
                  archivePath: "uploads/upload-session-1/archive.tar.gz",
                  objectIdentity: "object://artifact-store/upload-session-1/archive.tar.gz",
                  digest: "sha256:artifact",
                  sizeBytes: 42,
                  expiresAt: "2026-01-01T00:05:00.000Z",
                  provenance: "upload-session:upload-session:1",
                },
              },
            ],
          },
        },
      );
      assert.deepEqual(inventory.errors, []);
      const seen = kinds(inventory);
      for (const expected of [
        "Deployment",
        "ProviderTarget",
        "Component",
        "LanePolicy",
        "LaneGovernancePolicy",
        "AdmissionPolicy",
        "SourceRefPolicy",
        "SecretRequirement",
        "RuntimeConfigRequirement",
        "DeploymentContext",
        "ControlPlaneProfile",
        "ControlPlaneSelection",
        "ServiceClientProfile",
        "ArtifactInput",
        "ExecutionSnapshot",
        "DeployRun",
        "CurrentStageState",
        "ArtifactChallenge",
        "StaticWebappUploadSession",
      ]) {
        assert.equal(seen.has(expected as any), true, `${expected} should be inventoried`);
      }
      assert.deepEqual(inventory.workspace.supportedDeploymentQueryRoots, [
        "projects/deployments",
        "projects/apps",
        "projects/libs",
        "sandbox/deployments",
        "sandbox/apps",
        "sandbox/libs",
      ]);
      assert.equal(inventory.workspace.projectConfig.localPresent, true);
      assert.equal(
        inventory.workspace.projectConfig.redactedOverrides.some(
          (entry) => entry.localValue === "<redacted>",
        ),
        true,
      );
    },
  );
});

test("resource inventory reads deployment graph through the composite graph surface", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "resource-graph-inventory-"));
  try {
    await writeFile(
      tmp,
      ".viberoots/workspace/buck/graph.json",
      cloudflareNodes([
        cloudflareDeployment({
          provider_target: {
            account: "web-platform",
            project: "pleomino-staging",
          },
        }),
      ]),
    );
    await writeFile(tmp, DEFAULT_PROVIDER_INDEX_JSON_PATH, {
      "npm:fixture": { kind: "node", key: "npm:fixture" },
    });
    await writeFile(tmp, DEFAULT_NODE_LOCK_INDEX_PATH, { index: { fixture: "sha256:lock" } });
    const before = await listFiles(tmp);
    const inventory = await readDeploymentResourceInventory({ workspaceRoot: tmp });
    const after = await listFiles(tmp);
    assert.deepEqual(inventory.errors, []);
    assert.deepEqual(after, before);
    assert.equal(inventory.graphRead.providerIndexAvailable, true);
    assert.equal(inventory.graphRead.nodeLockIndexAvailable, true);
    assert.equal(kinds(inventory).has("Deployment"), true);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test("graph-first Infisical inventory paths use composite graph reads", async () => {
  for (const relPath of [
    "build-tools/tools/deployments/infisical-iac-bootstrap-resolver.ts",
    "build-tools/tools/deployments/infisical-iac-bootstrap-deployments-discovery.ts",
  ]) {
    const source = await fsp.readFile(viberootsRepoPath(relPath), "utf8");
    assert.match(source, /deploymentGraphReadOptions/);
    assert.match(source, /readCompositeGraph/);
    assert.doesNotMatch(source, /\breadGraph\s*\(/);
  }
});

test("resource inventory fails closed for invalid runtime source records", () => {
  const inventory = createDeploymentResourceInventory([], {
    runtimeSources: { artifactChallenges: [{ id: "bad", facts: { challengeId: "bad" } }] },
  });
  assert.match(
    inventory.errors.join("\n"),
    /missing deploymentId, proofKeyId, issuedAt, nonceValidationOutcome/,
  );
});

async function writeFile(tmp: string, relPath: string, value: unknown) {
  const target = path.join(tmp, relPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listFiles(root: string) {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else out.push(path.relative(root, fullPath));
    }
  }
  await walk(root);
  return out.sort();
}
