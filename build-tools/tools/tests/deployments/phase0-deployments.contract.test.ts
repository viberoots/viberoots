#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { extractDeployments } from "../../deployments/contract-extract";
import { validateDeploymentForCli } from "../../deployments/deploy-front-door";
import { appTargetBoundaryErrors } from "../../deployments/deployment-boundary-checks";
import { DEPLOYMENT_CQUERY_ATTRS } from "../../deployments/deployment-query-attrs";
import { resolveDeploymentFromTarget } from "../../deployments/deployment-query";
import { classifyReviewedBuildSystemVerifyPath } from "../../lib/deployment-verify-scope";
import { normalizeTargetLabel } from "../../lib/labels";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const DEPLOYMENT_LABELS = [
  "//projects/deployments/platform-foundation-dev:deploy",
  "//projects/deployments/platform-foundation-staging:deploy",
  "//projects/deployments/platform-foundation-prod:deploy",
  "//projects/deployments/data-room-console-dev:deploy",
  "//projects/deployments/data-room-console-staging:deploy",
  "//projects/deployments/data-room-console-prod:deploy",
  "//projects/deployments/data-room-web-dev:deploy",
  "//projects/deployments/data-room-web-staging:deploy",
  "//projects/deployments/data-room-web-prod:deploy",
  "//projects/deployments/data-room-worker-dev:deploy",
  "//projects/deployments/data-room-worker-staging:deploy",
  "//projects/deployments/data-room-worker-prod:deploy",
];

const MIGRATION_BUNDLE_LABEL = "//projects/deployments/platform-shared:migration_bundle";
const EXPECTED_MIGRATION_SETS = [
  "//projects/libs/platform-db:migrations",
  "//projects/libs/data-room-db:migrations",
];

function byId<T extends { deploymentId: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.deploymentId, item]));
}

async function queryPhase0Nodes() {
  const attrFlags = [...DEPLOYMENT_CQUERY_ATTRS, "deps"].flatMap((attr) => [
    "--output-attribute",
    attr,
  ]);
  const query = `deps(set(${[...DEPLOYMENT_LABELS, MIGRATION_BUNDLE_LABEL].join(" ")}), 2)`;
  const cquery = await $({
    env: { ...process.env, HOME: process.env.BUCK2_REAL_HOME || process.env.HOME },
  })`buck2 --isolation-dir ${inheritedBuckIsolation("phase0-deployments")} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}`;
  return nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "{}")));
}

test("Phase 0 deployment targets extract with concrete providers and app artifacts", async () => {
  const { deployments, errors } = extractDeployments(await queryPhase0Nodes());
  assert.deepEqual(errors, []);
  assert.equal(deployments.length, DEPLOYMENT_LABELS.length);

  const deploymentsById = byId(deployments);
  for (const deployment of deployments) {
    assert.equal(deployment.admissionPolicy.readinessGates?.[0]?.name, "phase0/ragie-acl");
    assert.equal(deployment.admissionPolicy.readinessGates?.[0]?.type, "ragie_acl_semantics");
    assert.equal(deployment.admissionPolicy.readinessGates?.[0]?.gateVersion, "phase0-2026-05");
    assert.deepEqual(deployment.admissionPolicy.readinessGates?.[0]?.requiredFor, [
      "deploy",
      "provision_only",
    ]);
    assert.ok(
      deployment.admissionPolicy.readinessGates?.some(
        (gate) => gate.type === "external_source_fetch_full_document_denial",
      ),
    );
  }
  assert.equal(deploymentsById.get("data-room-console-prod")?.provider, "vercel");
  assert.equal(
    deploymentsById.get("data-room-console-prod")?.component.target,
    "//projects/apps/data-room-console:vercel_artifact",
  );
  assert.equal(deploymentsById.get("data-room-console-prod")?.provisioner?.type, "opentofu-stack");
  assert.equal(deploymentsById.get("data-room-console-prod")?.runtimeConfigRequirements.length, 3);
  assert.equal(
    deploymentsById.get("data-room-web-prod")?.component.target,
    "//projects/apps/data-room-web:service_artifact",
  );
  assert.equal(deploymentsById.get("data-room-web-prod")?.provisioner?.type, "opentofu-stack");
  assert.equal(
    deploymentsById.get("data-room-worker-prod")?.component.target,
    "//projects/apps/data-room-worker:service_artifact",
  );
  assert.equal(deploymentsById.get("data-room-worker-prod")?.provisioner?.type, "opentofu-stack");

  for (const stage of ["dev", "staging", "prod"]) {
    const foundation = deploymentsById.get(`platform-foundation-${stage}`);
    assert.equal(foundation?.provider, "opentofu");
    assert.equal(foundation?.publisher.type, "provision-only");
    assert.equal(foundation?.provisioner?.type, "opentofu-stack");
    assert.ok(foundation?.secretRequirements.length);
    assert.equal(foundation?.migrationBundleRef, MIGRATION_BUNDLE_LABEL);
    assert.equal(foundation?.component.kind, "provision-only");
    assert.equal(foundation?.component.target, MIGRATION_BUNDLE_LABEL);
  }
});

test("Phase 0 scaffold has the expected deployment packages and stack files", async () => {
  const expectedPackages = DEPLOYMENT_LABELS.map((label) =>
    label.replace("//", "").replace(":deploy", ""),
  );
  for (const pkg of expectedPackages) {
    await fsp.access(path.join(process.cwd(), pkg, "TARGETS"));
    await fsp.access(path.join(process.cwd(), pkg, "opentofu", "stack.json"));
    await fsp.access(path.join(process.cwd(), pkg, "opentofu", "plan.json"));
    await fsp.access(path.join(process.cwd(), pkg, "opentofu", "plan.tfplan"));
  }
  await assert.rejects(
    fsp.access(path.join(process.cwd(), "projects/apps/platform-foundation/TARGETS")),
  );
});

test("Phase 0 migration bundle preserves Buck-declared migration order and identity", async () => {
  const nodes = await queryPhase0Nodes();
  const bundleNode = nodes.find((node) => node.name === MIGRATION_BUNDLE_LABEL);
  assert.deepEqual(
    Array.isArray(bundleNode?.migration_sets)
      ? bundleNode.migration_sets.map((label) => normalizeTargetLabel(String(label)))
      : [],
    EXPECTED_MIGRATION_SETS,
  );

  const result =
    await $`buck2 --isolation-dir ${inheritedBuckIsolation("phase0-migration-bundle")} build --target-platforms prelude//platforms:default --show-output ${MIGRATION_BUNDLE_LABEL}`;
  const outputPath = String(result.stdout)
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[1])
    .find(Boolean);
  assert.ok(outputPath);
  const bundle = JSON.parse(await fsp.readFile(path.join(outputPath, "manifest.json"), "utf8"));
  assert.equal(bundle.schema_version, "deployment-migration-bundle@1");
  assert.deepEqual(
    bundle.ordered_migration_sets.map((entry: { target: string }) => entry.target),
    EXPECTED_MIGRATION_SETS,
  );
  assert.equal(
    bundle.dependency_graph_fingerprint,
    `migration-sets:${EXPECTED_MIGRATION_SETS.join("|")}`,
  );
  assert.deepEqual(await fsp.readdir(path.join(outputPath, "migrations")), [
    "000_projects_libs_platform-db_migrations",
    "001_projects_libs_data-room-db_migrations",
  ]);
  assert.equal(
    (
      await fsp.readFile(
        path.join(
          outputPath,
          "migrations/000_projects_libs_platform-db_migrations/migrations/001_platform_foundation.sql",
        ),
        "utf8",
      )
    ).trim(),
    "-- Phase 0 placeholder platform migration.\nselect 1;",
  );
  assert.equal(
    (
      await fsp.readFile(
        path.join(
          outputPath,
          "migrations/001_projects_libs_data-room-db_migrations/migrations/001_data_room_foundation.sql",
        ),
        "utf8",
      )
    ).trim(),
    "-- Phase 0 placeholder data-room migration.\nselect 1;",
  );
});

test("migration bundle fails closed when a declared migration dependency is missing", async () => {
  await runInTemp("phase0-missing-migration-bundle-dep", async (tmp, $tmp) => {
    await fsp.mkdir(path.join(tmp, "build-tools/deployments"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "build-tools/deployments/migration_bundle_rules.bzl"),
      await fsp.readFile(
        path.join(process.cwd(), "build-tools/deployments/migration_bundle_rules.bzl"),
        "utf8",
      ),
      "utf8",
    );
    await fsp.writeFile(path.join(tmp, "build-tools/deployments/TARGETS"), "", "utf8");
    await fsp.mkdir(path.join(tmp, "sandbox/deployments"), { recursive: true });
    await fsp.writeFile(
      path.join(tmp, "sandbox/deployments/TARGETS"),
      [
        'load("//build-tools/deployments:migration_bundle_rules.bzl", "migration_bundle")',
        "",
        "migration_bundle(",
        '    name = "bundle",',
        '    migration_sets = ["//sandbox/libs/db:missing_migrations"],',
        '    visibility = ["PUBLIC"],',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await $tmp({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms prelude//platforms:default //sandbox/deployments:bundle`
      .quiet()
      .nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /missing_migrations|does not exist|not found/i);
  });
});

test("protected Phase 0 front-door validation rejects placeholder identities", async () => {
  const deployment = await resolveDeploymentFromTarget(
    process.cwd(),
    "//projects/deployments/platform-foundation-prod:deploy",
  );
  await assert.rejects(
    validateDeploymentForCli(process.cwd(), deployment),
    /placeholder deployment value is unresolved:/,
  );
});

test("Phase 0 concrete app targets use real app components without cross-app imports", async () => {
  const nodes = await queryPhase0Nodes();
  const { deployments, errors } = extractDeployments(nodes);
  assert.deepEqual(errors, []);
  for (const deployment of deployments.filter((entry) => entry.provider !== "opentofu")) {
    for (const component of deployment.components) {
      assert.match(component.target, /^\/\/projects\/apps\/[^/]+:/, deployment.label);
    }
  }
  assert.deepEqual(appTargetBoundaryErrors(nodes), []);
});

test("Phase 0 deployment test selector is deployment-owned", () => {
  assert.equal(
    classifyReviewedBuildSystemVerifyPath(
      "build-tools/tools/tests/deployments/phase0-deployments.contract.test.ts",
    ),
    "deployment-owned",
  );
});
