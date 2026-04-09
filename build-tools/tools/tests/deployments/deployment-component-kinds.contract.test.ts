#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEPLOYMENT_COMPONENT_KINDS,
  componentKindRequiresRuntimeContract,
  defaultSmokeClassForComponentKind,
} from "../../deployments/deployment-component-kinds.ts";

test("canonical deployment component kind registry includes the reviewed non-static kinds", () => {
  assert.deepEqual(DEPLOYMENT_COMPONENT_KINDS, [
    "static-webapp",
    "ssr-webapp",
    "mobile-app",
    "service",
    "third-party-service",
  ]);
});

test("default smoke classes follow the reviewed component-kind contract", () => {
  assert.equal(defaultSmokeClassForComponentKind("static-webapp"), "http_5m");
  assert.equal(defaultSmokeClassForComponentKind("ssr-webapp"), "http_10m");
  assert.equal(defaultSmokeClassForComponentKind("mobile-app"), "release_health");
  assert.equal(defaultSmokeClassForComponentKind("service"), "service_health_10m");
  assert.equal(defaultSmokeClassForComponentKind("third-party-service"), "service_health_10m");
});

test("ssr-webapp is the reviewed kind that requires a runtime contract reference", () => {
  assert.equal(componentKindRequiresRuntimeContract("static-webapp"), false);
  assert.equal(componentKindRequiresRuntimeContract("ssr-webapp"), true);
  assert.equal(componentKindRequiresRuntimeContract("mobile-app"), false);
  assert.equal(componentKindRequiresRuntimeContract("service"), false);
  assert.equal(componentKindRequiresRuntimeContract("third-party-service"), false);
});
