#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { isSupportedComponentNode } from "../../deployments/deployment-component-kinds";
import { normalizeTargetLabel } from "../../lib/labels";
import { runInTemp } from "../lib/test-helpers";

function labelsFor(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as Record<string, { labels?: string[] }>;
  const entry = Object.entries(parsed).find(
    ([label]) => normalizeTargetLabel(label) === "//projects/apps/service:artifact",
  );
  return Array.isArray(entry?.[1].labels) ? entry[1].labels.map(String) : [];
}

test("node_service_artifact stamps deployable service component labels", async () => {
  await runInTemp("node-service-artifact-cquery", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "service");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "service.runtime.json"),
      JSON.stringify({
        schemaVersion: "node-service-runtime@1",
        serviceName: "service",
        entrypoint: "index.js",
        productionCommand: ["node", "dist/index.js"],
        health: { path: "/healthz", port: 3000 },
        runtimeConfig: ["PORT"],
        secretRequirements: [],
      }) + "\n",
    );
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_service_artifact")',
        "node_service_artifact(",
        '  name = "artifact",',
        '  lockfile_label = "lockfile:projects/apps/service/pnpm-lock.yaml#projects/apps/service",',
        ")",
      ].join("\n"),
    );
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels //projects/apps/service:artifact`;
    const labels = labelsFor(String(result.stdout || ""));
    for (const label of [
      "lang:node",
      "kind:app",
      "service:node",
      "deployable:app",
      "deployment-component:service",
      "artifact:node-service",
    ]) {
      assert.ok(labels.includes(label), `expected ${label}`);
    }
    assert.equal(isSupportedComponentNode("service", { labels } as any), true);
  });
});
