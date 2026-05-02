#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { isSupportedComponentNode } from "../../deployments/deployment-component-kinds.ts";
import { normalizeTargetLabel } from "../../lib/labels.ts";
import { runInTemp } from "../lib/test-helpers.ts";

function parseLabels(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as Record<string, { labels?: string[] }>;
  const entry = Object.entries(parsed).find(
    ([label]) => normalizeTargetLabel(label) === "//projects/apps/web:vercel_artifact",
  );
  return Array.isArray(entry?.[1].labels) ? entry[1].labels.map(String) : [];
}

function parseSrcs(stdout: string): string {
  const parsed = JSON.parse(stdout) as Record<string, { srcs?: unknown }>;
  const entry = Object.entries(parsed).find(
    ([label]) => normalizeTargetLabel(label) === "//projects/apps/web:vercel_artifact",
  );
  return JSON.stringify(entry?.[1].srcs || "");
}

test("node_vercel_next_artifact stamps deployable SSR component labels", async () => {
  await runInTemp("node-vercel-next-cquery", async (tmp, $) => {
    const appDir = path.join(tmp, "projects", "apps", "web");
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(path.join(appDir, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
    await fsp.writeFile(
      path.join(appDir, "vercel.project.json"),
      JSON.stringify({
        schemaVersion: "vercel-next-artifact@1",
        projectName: "web",
        framework: "nextjs",
        runtime: { nodeVersion: "22.x", buildEnv: [], runtimeEnv: [] },
      }) + "\n",
    );
    await fsp.writeFile(
      path.join(appDir, "TARGETS"),
      [
        'load("//build-tools/node:defs.bzl", "node_vercel_next_artifact")',
        "",
        "node_vercel_next_artifact(",
        '  name = "vercel_artifact",',
        '  lockfile_label = "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",',
        ")",
        "",
      ].join("\n"),
      "utf8",
    );
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`buck2 cquery --target-platforms //:no_cgo --json --output-attribute labels --output-attribute srcs //projects/apps/web:vercel_artifact`;
    const labels = parseLabels(String(result.stdout || ""));
    for (const label of [
      "lang:node",
      "kind:app",
      "webapp:ssr",
      "framework:next",
      "deployable:app",
      "deployment-component:ssr-webapp",
      "vercel:prebuilt",
    ]) {
      assert.ok(labels.includes(label), `expected ${label}`);
    }
    assert.match(parseSrcs(String(result.stdout || "")), /vercel\.project\.json/);
    assert.equal(isSupportedComponentNode("ssr-webapp", { labels } as any), true);
  });
});
