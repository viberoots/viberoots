#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GraphNode } from "../../deployments/lib/graph";
import { resolveDeploymentContextNode } from "../../deployments/deployment-contexts";

test("kubernetes deployment_context preserves omitted protection_class local-only default", () => {
  assert.deepEqual(resolveErrorsFor("kubernetes"), []);
});

test("opentofu deployment_context preserves omitted protection_class local-only default", () => {
  assert.deepEqual(resolveErrorsFor("opentofu"), []);
});

test("shared-default providers still require controlPlane when protection_class is omitted", () => {
  assert.match(
    resolveErrorsFor("cloudflare-pages").join("\n"),
    /protected\/shared deployment_context app-local must select a valid controlPlane/,
  );
});

function resolveErrorsFor(provider: string) {
  const errors: string[] = [];
  resolveDeploymentContextNode({
    node: deploymentNode(provider),
    config: {
      deploymentContexts: {
        "app-local": {},
      },
    },
    errors,
  });
  return errors;
}

function deploymentNode(provider: string): GraphNode {
  return {
    name: `//projects/deployments/${provider}:app`,
    provider,
    deployment_context: "app-local",
  };
}
