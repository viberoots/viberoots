#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { readDeploymentSmokePolicy } from "../../deployments/deployment-smoke-policy";

test("deployment smoke metadata parses runner, URL, path, and status from fixtures", () => {
  const smoke = readDeploymentSmokePolicy({
    name: "//fixture/deployments/web-prod:deploy",
    smoke: {
      runner: "http",
      runner_class: "http_10m",
      url: "https://web.fixture.example.test",
      path: "/healthz",
      expected_status: "200",
    },
  });
  assert.deepEqual(smoke, {
    runner: "http",
    runnerClass: "http_10m",
    url: "https://web.fixture.example.test",
    path: "/healthz",
    expectedStatus: "200",
  });
});

test("service health smoke metadata remains provider-neutral", () => {
  const smoke = readDeploymentSmokePolicy({
    name: "//fixture/deployments/worker-prod:deploy",
    smoke: {
      runner: "http",
      runner_class: "service_health_10m",
      url: "service://worker-prod",
      path: "/healthz",
      expected_status: "200",
    },
  });
  assert.equal(smoke?.runnerClass, "service_health_10m");
  assert.equal(smoke?.url, "service://worker-prod");
});
