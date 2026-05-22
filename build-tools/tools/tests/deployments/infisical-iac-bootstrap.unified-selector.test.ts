#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { requiredBackendProfiles } from "../../deployments/infisical-iac-bootstrap-resolver";

test("repo resolver profile discovery accepts unified backend selectors", async () => {
  const graphPath = await writeGraph([
    { name: "//deployments/app:build" },
    { name: "//deployments/default:deploy", secret_backend: "infisical/default" },
    { name: "//deployments/regulated:deploy", secret_backend: "infisical/regulated" },
    { name: "//deployments/vault:deploy", secret_backend: "vault/default" },
  ]);
  const profiles = await requiredBackendProfiles(graphPath);
  assert.deepEqual([...profiles].sort(), [
    "infisical-default",
    "infisical-regulated",
    "vault-default",
  ]);
});

test("repo resolver profile discovery maps omitted backend requirements to vault default", async () => {
  const graphPath = await writeGraph([
    { name: "//deployments/app:build" },
    {
      name: "//deployments/implicit-vault:deploy",
      secret_requirements: [{ name: "api_token", contract_id: "secret://deployments/api_token" }],
    },
  ]);
  const profiles = await requiredBackendProfiles(graphPath);
  assert.deepEqual([...profiles], ["vault-default"]);
});

test("repo resolver profile discovery ignores nodes with no backend need", async () => {
  const graphPath = await writeGraph([
    { name: "//deployments/app:build" },
    { name: "//deployments/no-secrets:deploy", secret_requirements: [] },
  ]);
  const profiles = await requiredBackendProfiles(graphPath);
  assert.deepEqual([...profiles], []);
});

test("repo resolver profile discovery rejects split backend metadata", async () => {
  const graphPath = await writeGraph([
    {
      name: "//deployments/mismatch:deploy",
      secret_backend: "vault",
      secret_backend_profile: "infisical-default",
    },
  ]);
  await assert.rejects(
    () => requiredBackendProfiles(graphPath),
    /secret_backend must use[\s\S]*secret_backend_profile is unsupported/,
  );
});

async function writeGraph(nodes: unknown[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "infisical-bootstrap-unified-selector-"));
  const graphPath = path.join(dir, "graph.json");
  await fs.writeFile(graphPath, `${JSON.stringify({ nodes }, null, 2)}\n`, "utf8");
  return graphPath;
}
