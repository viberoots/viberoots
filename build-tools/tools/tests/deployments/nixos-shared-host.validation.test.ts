#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { extractNixosSharedHostDeployments } from "../../deployments/contract.ts";
import { REVIEWED_NON_STATIC_COMPONENT_KINDS } from "../../deployments/deployment-provider-capabilities.ts";
import type { GraphNode } from "../../lib/graph.ts";
import {
  nixosSharedHostAdmissionPolicyNodeFixture,
  nixosSharedHostLanePolicyNodeFixture,
} from "./nixos-shared-host.fixture.ts";
import {
  deploymentNode,
  policyNodes,
  ssrWebappComponent,
  staticWebappComponent,
} from "./nixos-shared-host.validation.helpers.ts";

test("validation rejects duplicate app_name collisions", () => {
  const nodes: GraphNode[] = [
    staticWebappComponent("//projects/apps/demoapp:app"),
    staticWebappComponent("//projects/apps/other:app"),
    ...policyNodes(),
    deploymentNode(),
    deploymentNode({
      name: "//projects/deployments/other-dev:deploy",
      component: "//projects/apps/other:app",
    }),
  ];
  const { errors } = extractNixosSharedHostDeployments(nodes);
  assert.ok(errors.some((entry) => entry.includes('duplicate app_name "demoapp"')));
});

test("validation rejects missing container_port", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({ container_port: 0 }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("container_port must be an integer")));
});

test("validation rejects invalid target_group", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({ target_group: "group.a" }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("target_group must be lowercase")));
});

test("validation rejects protected/shared lane policy without governance metadata", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    nixosSharedHostLanePolicyNodeFixture({ governance_policy: "" }),
    nixosSharedHostAdmissionPolicyNodeFixture(),
    deploymentNode(),
  ]);
  assert.ok(errors.some((entry) => entry.includes("lane policy must define governance_policy")));
});

test("validation rejects unsupported component kinds for nixos-shared-host", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({ component_kind: "http-service" }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes('does not support component_kind "http-service"')),
  );
});

test("validation rejects protected multi-component shared-host deployments without rollout_policy", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    staticWebappComponent("//projects/apps/demoapi:app"),
    ...policyNodes(),
    deploymentNode({
      components: [
        {
          id: "frontend",
          kind: "static-webapp",
          target: "//projects/apps/demoapp:app",
          app_name: "demoapp",
          container_port: "3000",
        },
        {
          id: "api",
          kind: "static-webapp",
          target: "//projects/apps/demoapi:app",
          app_name: "demoapi",
          container_port: "3001",
        },
      ],
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("must set rollout_policy")));
});

test("validation rejects multi-component shared-host rollout steps that omit a component", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    staticWebappComponent("//projects/apps/demoapi:app"),
    ...policyNodes(),
    deploymentNode({
      components: [
        {
          id: "frontend",
          kind: "static-webapp",
          target: "//projects/apps/demoapp:app",
          app_name: "demoapp",
          container_port: "3000",
        },
        {
          id: "api",
          kind: "static-webapp",
          target: "//projects/apps/demoapi:app",
          app_name: "demoapi",
          container_port: "3001",
        },
      ],
      rollout_policy: {
        mode: "ordered_best_effort",
        abort: "stop_on_first_failure",
        smoke: "final_only",
      },
      rollout_steps: ["frontend"],
    }),
  ]);
  assert.ok(
    errors.some((entry) => entry.includes("steps must list every component id exactly once")),
  );
});

test("validation rejects malformed bootstrap policy", () => {
  const { errors } = extractNixosSharedHostDeployments([
    staticWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({
      bootstrap: {
        scope: "ordinary_deploy",
      },
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported bootstrap.scope")));
  assert.ok(
    errors.some((entry) =>
      entry.includes("bootstrap policy must enable allow_first_install or allow_offline_recovery"),
    ),
  );
});

test("validation rejects reviewed non-static kinds until nixos-shared-host declares capability support", () => {
  for (const kind of REVIEWED_NON_STATIC_COMPONENT_KINDS.filter(
    (entry) => entry !== "ssr-webapp",
  )) {
    const { errors } = extractNixosSharedHostDeployments([
      staticWebappComponent("//projects/apps/demoapp:app"),
      ...policyNodes(),
      deploymentNode({ component_kind: kind }),
    ]);
    assert.ok(
      errors.some((entry) => entry.includes(`does not support component_kind "${kind}"`)),
      `expected nixos-shared-host to reject ${kind}, saw: ${errors.join("\n")}`,
    );
  }
});

test("validation accepts the reviewed single-component ssr-webapp slice", () => {
  const { deployments, errors } = extractNixosSharedHostDeployments([
    ssrWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({
      component_kind: "ssr-webapp",
      publisher: "nixos-shared-host-ssr-webapp",
      components: [
        {
          id: "default",
          kind: "ssr-webapp",
          target: "//projects/apps/demoapp:app",
          app_name: "demoapp",
          container_port: "3000",
          health_path: "/healthz",
          ssr_framework: "vite",
          ssr_runtime_contract: "node-dist-server-v1",
          ssr_server_entry: "dist/server/index.js",
          ssr_client_dir: "dist/client",
          ssr_serving_topology: "single-host-node-with-nginx",
          ssr_environment_neutral_build: "true",
        },
      ],
    }),
  ]);
  assert.deepEqual(errors, []);
  assert.equal(deployments[0]?.component.kind, "ssr-webapp");
  assert.equal(
    (deployments[0]?.components[0] as any)?.runtime?.runtimeContract?.type,
    "node-dist-server-v1",
  );
});

test("validation rejects reviewed host SSR slices with unsupported runtime-contract drift", () => {
  const { errors } = extractNixosSharedHostDeployments([
    ssrWebappComponent("//projects/apps/demoapp:app"),
    ...policyNodes(),
    deploymentNode({
      component_kind: "ssr-webapp",
      publisher: "nixos-shared-host-ssr-webapp",
      components: [
        {
          id: "default",
          kind: "ssr-webapp",
          target: "//projects/apps/demoapp:app",
          app_name: "demoapp",
          container_port: "3000",
          ssr_framework: "vite",
          ssr_runtime_contract: "custom-runtime",
          ssr_server_entry: "server.js",
          ssr_client_dir: "public",
          ssr_serving_topology: "other-topology",
          ssr_environment_neutral_build: "false",
        },
      ],
    }),
  ]);
  assert.ok(errors.some((entry) => entry.includes("unsupported ssr_runtime_contract")));
  assert.ok(
    errors.some((entry) => entry.includes("ssr_server_entry must be dist/server/index.js")),
  );
  assert.ok(errors.some((entry) => entry.includes("ssr_client_dir must be dist/client")));
  assert.ok(errors.some((entry) => entry.includes("unsupported ssr_serving_topology")));
  assert.ok(errors.some((entry) => entry.includes("ssr_environment_neutral_build must be true")));
});
