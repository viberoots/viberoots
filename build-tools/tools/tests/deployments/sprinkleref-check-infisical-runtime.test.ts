#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { collectTargetRefs } from "../../deployments/sprinkleref-check-target";
import { renderReport, summarize } from "../../deployments/sprinkleref-check-report";
import { runInTemp } from "../lib/test-helpers";

test("target check carries Infisical runtime backend metadata", async () => {
  await runInTemp("sprinkleref-check-target-infisical-runtime", async (tmp) => {
    await writeInfisicalRuntimeTarget(tmp);
    const refs = await collectTargetRefs({
      cwd: tmp,
      target: "//projects/deployments/check-infisical/prod:deploy",
      deps: "none",
    });
    assert.deepEqual(
      refs.map((entry) => ({
        ref: entry.ref,
        backendEnvironment: entry.backendEnvironment,
        backendHost: entry.backendHost,
        backendProjectId: entry.backendProjectId,
        backendProjectName: entry.backendProjectName,
        backendSecretPath: entry.backendSecretPath,
      })),
      [
        {
          ref: "secret://deployments/check-infisical/api_token",
          backendEnvironment: "prod",
          backendHost: "https://app.infisical.com",
          backendProjectId: "proj_live",
          backendProjectName: "check-infisical-deployments",
          backendSecretPath: "/",
        },
      ],
    );
  });
});

test("Infisical runtime metadata overrides resolver profile context in check output", () => {
  const entry = {
    ref: "secret://deployments/check-infisical/api_token",
    scheme: "secret" as const,
    sensitive: true,
    status: "missing" as const,
    scope: "direct" as const,
    locations: ["projects/deployments/check-infisical/prod/TARGETS:1"],
    requiredBy: ["//projects/deployments/check-infisical/prod:deploy"],
    category: "main",
    backend: "infisical project proj_live (check-infisical-deployments) environment prod",
    backendProjectId: "proj_live",
    backendProjectName: "check-infisical-deployments",
    backendEnvironment: "prod",
  };
  const text = renderReport({
    target: "//projects/deployments/check-infisical/prod:deploy",
    deps: "none",
    scannedFiles: 0,
    refs: [entry],
    summary: summarize([entry]),
  });
  assert.match(text, /project: check-infisical-deployments \(proj_live\)/);
  assert.doesNotMatch(text, /repo-deployments/);
});

async function writeInfisicalRuntimeTarget(tmp: string): Promise<void> {
  const dir = path.join(tmp, "projects", "deployments", "check-infisical", "prod");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'load("@viberoots//build-tools/deployments:metadata_rules.bzl", "deployment_target")',
      "",
      'genrule(name = "app", out = "app.txt", cmd = "printf app > $OUT")',
      "deployment_target(",
      '    name = "deploy",',
      '    provider = "test",',
      '    component = ":app",',
      '    component_kind = "test",',
      '    publisher = "test",',
      '    environment_stage = "staging",',
      "    infisical_runtime = {",
      '        "site_url": "https://app.infisical.com",',
      '        "project_id": "proj_live",',
      '        "project_name": "check-infisical-deployments",',
      '        "environment": "prod",',
      '        "secret_path": "/",',
      "    },",
      "    secret_requirements = [",
      '        {"name": "api_token", "step": "publish", "contract_id": "secret://deployments/check-infisical/api_token", "required": "true"},',
      "    ],",
      ")",
      "",
    ].join("\n"),
  );
}
