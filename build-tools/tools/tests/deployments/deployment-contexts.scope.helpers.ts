#!/usr/bin/env zx-wrapper
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { GraphNode } from "../../lib/graph";
import {
  cloudflarePagesAdmissionPolicyNodeFixture,
  cloudflarePagesLaneGovernanceNodeFixture,
  cloudflarePagesLanePolicyNodeFixture,
} from "./cloudflare-pages.fixture";
import {
  s3StaticAdmissionPolicyNodeFixture,
  s3StaticLanePolicyNodeFixture,
} from "./s3-static.fixture";
import { nixosSharedHostLaneGovernanceNodeFixture } from "./deployment-lane-governance.fixture";

const $ = globalThis.$;

export function appNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/apps/sample-webapp:app",
    labels: ["kind:app", "webapp:pwa"],
    ...overrides,
  };
}

export function cloudflareNodes(deployments: GraphNode[]) {
  return [
    appNode(),
    cloudflarePagesLaneGovernanceNodeFixture(),
    cloudflarePagesLanePolicyNodeFixture(),
    cloudflarePagesAdmissionPolicyNodeFixture(),
    ...deployments,
  ];
}

export function cloudflareDeployment(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/sample-webapp/staging:deploy",
    provider: "cloudflare-pages",
    component: "//projects/apps/sample-webapp:app",
    component_kind: "static-webapp",
    publisher: "wrangler-pages",
    publisher_config: "wrangler.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/sample-webapp/shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/sample-webapp/shared:staging_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: {},
    ...overrides,
  };
}

export function s3Deployment(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    ...cloudflareDeployment({
      name: "//projects/deployments/sample-webapp/staging-s3:deploy",
      provider: "s3-static",
      publisher: "aws-s3-sync",
      publisher_config: "aws-s3-sync.jsonc",
      provider_target: { bucket: "sample-webapp-staging-site" },
    }),
    ...overrides,
  };
}

export function s3Nodes(deployments: GraphNode[]) {
  return [
    appNode({ labels: ["kind:app", "webapp:static"] }),
    s3StaticLanePolicyNodeFixture(),
    nixosSharedHostLaneGovernanceNodeFixture({
      source_ref_policies: [
        { stage: "dev", allowed_refs: "main", required_checks: "deploy/sample-webapp-dev" },
        {
          stage: "staging",
          allowed_refs: "main",
          required_checks: "deploy/sample-webapp-staging-s3",
        },
        {
          stage: "prod",
          allowed_refs: "refs/tags/release/fixture",
          required_checks: "deploy/sample-webapp-prod",
        },
      ],
    }),
    s3StaticAdmissionPolicyNodeFixture(),
    ...deployments,
  ];
}

export async function withProjectConfig(shared: Record<string, unknown>, run: () => Promise<void>) {
  const oldCwd = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deployment-contexts-scope-"));
  try {
    process.chdir(dir);
    await writeJson("projects/config/shared.json", {
      schemaVersion: "viberoots-project-config@1",
      ...shared,
    });
    await $({ cwd: dir, stdio: "pipe" })`git init --initial-branch=main`;
    await $({ cwd: dir, stdio: "pipe" })`git config user.email test@example.invalid`;
    await $({ cwd: dir, stdio: "pipe" })`git config user.name "Viberoots Test"`;
    await $({ cwd: dir, stdio: "pipe" })`git add projects/config/shared.json`;
    await $({ cwd: dir, stdio: "pipe" })`git commit -m "project config fixture"`;
    await run();
  } finally {
    process.chdir(oldCwd);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function writeJson(relativePath: string, value: unknown) {
  await fs.mkdir(path.dirname(relativePath), { recursive: true });
  await fs.writeFile(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function withEnv(name: string, value: string, run: () => Promise<void>) {
  const oldValue = process.env[name];
  process.env[name] = value;
  try {
    await run();
  } finally {
    if (oldValue === undefined) delete process.env[name];
    else process.env[name] = oldValue;
  }
}
