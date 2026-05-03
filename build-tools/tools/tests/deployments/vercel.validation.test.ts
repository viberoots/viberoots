#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareVercelPublisherConfig } from "../../deployments/vercel-config.ts";
import type { GraphNode } from "../../lib/graph.ts";
import { extractVercelDeployments } from "../../deployments/contract.ts";
import { vercelDeploymentFixture, vercelPolicyNodes } from "./vercel.fixture.ts";

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    name: "//projects/deployments/console-staging:deploy",
    provider: "vercel",
    component: "//projects/apps/console:app",
    component_kind: "ssr-webapp",
    publisher: "vercel-prebuilt",
    publisher_config: "vercel-prebuilt.jsonc",
    protection_class: "shared_nonprod",
    lane_policy: "//projects/deployments/pleomino-shared:lane",
    environment_stage: "staging",
    admission_policy: "//projects/deployments/pleomino-shared:staging_release",
    secret_requirements: [],
    runtime_config_requirements: [],
    provider_target: { team: "web-platform", project: "console-staging", environment: "staging" },
    ...overrides,
  };
}

function errorsFor(overrides: Partial<GraphNode> = {}): string[] {
  return extractVercelDeployments([
    { name: "//projects/apps/console:app", labels: ["kind:app", "webapp:ssr"] },
    ...vercelPolicyNodes(),
    node(overrides),
  ]).errors;
}

test("validation rejects unsupported Vercel publishers including Git auto-build", () => {
  assert.ok(
    errorsFor({ publisher: "vercel-git-autobuild" }).some((entry) =>
      entry.includes('unsupported vercel publisher "vercel-git-autobuild"'),
    ),
  );
  assert.ok(
    errorsFor({ publisher_config: "" }).some((entry) =>
      entry.includes("missing required publisher_config"),
    ),
  );
});

test("validation rejects unsupported component kinds and multi-component Vercel deployments", () => {
  assert.ok(
    errorsFor({ component_kind: "static-webapp" }).some((entry) =>
      entry.includes('does not support component_kind "static-webapp"'),
    ),
  );
  assert.ok(
    errorsFor({
      components: [
        { id: "a", kind: "ssr-webapp", target: "//projects/apps/console:app" },
        { id: "b", kind: "ssr-webapp", target: "//projects/apps/console-admin:app" },
      ],
    }).some((entry) => entry.includes("does not support multi-component")),
  );
});

test("validation rejects Vercel preview metadata and git-autobuild config mode", async () => {
  assert.ok(
    errorsFor({ preview: { target_derivation: "provider_managed_source_run" } }).some((entry) =>
      entry.includes("vercel does not support preview"),
    ),
  );
  const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "vercel-config-"));
  try {
    const configPath = path.join(
      workspaceRoot,
      "projects",
      "deployments",
      "console-staging",
      "vercel-prebuilt.jsonc",
    );
    await fsp.mkdir(path.dirname(configPath), { recursive: true });
    await fsp.writeFile(configPath, '{ "mode": "git-autobuild" }\n', "utf8");
    await assert.rejects(
      () =>
        prepareVercelPublisherConfig({
          workspaceRoot,
          deployment: vercelDeploymentFixture(),
          outputPath: path.join(workspaceRoot, "rendered.json"),
        }),
      /git-autobuild mode is not allowed/,
    );
  } finally {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  }
});
