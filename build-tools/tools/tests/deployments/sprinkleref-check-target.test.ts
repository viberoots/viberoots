#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { collectTargetRefs } from "../../deployments/sprinkleref-check-target";
import { renderReport, summarize } from "../../deployments/sprinkleref-check-report";
import { runInTemp } from "../lib/test-helpers";

test("target check collects direct and dependency structured refs", async () => {
  await runInTemp("sprinkleref-check-target", async (tmp) => {
    await writeTargets(tmp);
    const transitive = await collectTargetRefs({
      cwd: tmp,
      target: "//projects/deployments/check-demo:deploy",
      deps: "transitive",
    });
    assert.deepEqual(
      transitive.map((entry) => [entry.ref, entry.scope, entry.requiredBy]),
      [
        [
          "config://deployments/check-demo/public_url",
          "direct",
          "//projects/deployments/check-demo:deploy",
        ],
        [
          "runtime://deployments/check-demo/app_id",
          "dependency",
          "//projects/deployments/check-demo:component",
        ],
        [
          "secret://deployments/check-demo/api_token",
          "direct",
          "//projects/deployments/check-demo:deploy",
        ],
      ],
    );
    const direct = await collectTargetRefs({
      cwd: tmp,
      target: "//projects/deployments/check-demo:deploy",
      deps: "none",
    });
    assert.equal(direct.length, 2);
    assert.ok(direct.every((entry) => entry.scope === "direct"));
  });
});

test("target check locates refs defined by shared macro files", async () => {
  await runInTemp("sprinkleref-check-target-shared-source", async (tmp) => {
    await writeSharedMacroTargets(tmp);
    const refs = await collectTargetRefs({
      cwd: tmp,
      target: "//projects/deployments/check-staging:deploy",
      deps: "none",
    });
    assert.deepEqual(
      refs.map((entry) => entry.locations),
      [["projects/deployments/check-shared/family.bzl:6"]],
    );
  });
});

test("target human output separates actionable direct refs from dependency refs", () => {
  const text = renderReport({
    target: "//projects/deployments/check-demo:deploy",
    deps: "transitive",
    scannedFiles: 0,
    refs: [
      {
        ref: "secret://deployments/check-demo/api_token",
        scheme: "secret",
        sensitive: true,
        status: "missing",
        scope: "direct",
        locations: ["projects/deployments/check-demo/TARGETS:21"],
        requiredBy: ["//projects/deployments/check-demo:deploy"],
        category: "main",
        backend: "infisical project proj_123 environment staging",
      },
      {
        ref: "runtime://deployments/check-demo/app_id",
        scheme: "runtime",
        sensitive: false,
        status: "declared",
        scope: "dependency",
        locations: ["projects/deployments/check-demo/TARGETS:16"],
        requiredBy: ["//projects/deployments/check-demo:component"],
      },
      {
        ref: "secret://deployments/check-demo/shared_token",
        scheme: "secret",
        sensitive: true,
        status: "missing",
        scope: "dependency",
        locations: ["projects/deployments/check-demo/TARGETS:19"],
        requiredBy: ["//projects/deployments/check-demo:component"],
      },
    ],
    summary: summarize([
      {
        ref: "secret://deployments/check-demo/api_token",
        scheme: "secret",
        sensitive: true,
        status: "missing",
        scope: "direct",
        locations: [],
        requiredBy: [],
      },
      {
        ref: "runtime://deployments/check-demo/app_id",
        scheme: "runtime",
        sensitive: false,
        status: "declared",
        scope: "dependency",
        locations: [],
        requiredBy: [],
      },
      {
        ref: "secret://deployments/check-demo/shared_token",
        scheme: "secret",
        sensitive: true,
        status: "missing",
        scope: "dependency",
        locations: [],
        requiredBy: [],
      },
    ]),
  });
  assert.match(text, /Direct refs[\s\S]*secret:\/\/deployments\/check-demo\/api_token/);
  assert.match(text, /From dependencies[\s\S]*secret:\/\/deployments\/check-demo\/shared_token/);
  assert.doesNotMatch(text, /runtime:\/\/deployments\/check-demo\/app_id/);
  assert.equal(text.match(/secret:\/\/deployments\/check-demo\/api_token/g)?.length, 1);
});

test("target check fails instead of falling back to repo text scan", async () => {
  await runInTemp("sprinkleref-check-target-missing-metadata", async (tmp) => {
    await writePlainTarget(tmp);
    await assert.rejects(
      () =>
        collectTargetRefs({
          cwd: tmp,
          target: "//projects/deployments/check-demo:plain",
          deps: "none",
        }),
      /did not expose structured SprinkleRef requirement metadata/,
    );
  });
});

async function writeTargets(tmp: string): Promise<void> {
  const dir = path.join(tmp, "projects", "deployments", "check-demo");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'load("//build-tools/deployments:metadata_rules.bzl", "deployment_target")',
      "",
      "genrule(",
      '    name = "app",',
      '    out = "app.txt",',
      '    cmd = "printf app > $OUT",',
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_target(",
      '    name = "component",',
      '    provider = "test",',
      '    component = ":app",',
      '    component_kind = "test",',
      '    publisher = "test",',
      "    runtime_config_requirements = [",
      '        {"name": "app_id", "step": "publish", "contract_id": "runtime://deployments/check-demo/app_id", "required": "true"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
      "deployment_target(",
      '    name = "deploy",',
      '    provider = "test",',
      '    component = ":component",',
      '    component_kind = "test",',
      '    publisher = "test",',
      "    secret_requirements = [",
      '        {"name": "api_token", "step": "publish", "contract_id": "secret://deployments/check-demo/api_token", "required": "true"},',
      "    ],",
      "    runtime_config_requirements = [",
      '        {"name": "public_url", "step": "publish", "contract_id": "config://deployments/check-demo/public_url", "required": "true"},',
      "    ],",
      '    visibility = ["PUBLIC"],',
      ")",
      "",
    ].join("\n"),
  );
}

async function writePlainTarget(tmp: string): Promise<void> {
  const dir = path.join(tmp, "projects", "deployments", "check-demo");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      "genrule(",
      '    name = "plain",',
      '    out = "plain.txt",',
      '    cmd = "printf secret://deployments/check-demo/api_token > $OUT",',
      ")",
      "",
    ].join("\n"),
  );
}

async function writeSharedMacroTargets(tmp: string): Promise<void> {
  const shared = path.join(tmp, "projects", "deployments", "check-shared");
  const stage = path.join(tmp, "projects", "deployments", "check-staging");
  await fs.mkdir(shared, { recursive: true });
  await fs.mkdir(stage, { recursive: true });
  await fs.writeFile(
    path.join(shared, "family.bzl"),
    [
      'load("//build-tools/deployments:metadata_rules.bzl", "deployment_target")',
      "",
      "def check_deployment(name, component):",
      "    deployment_target(",
      "        name = name,",
      '        secret_requirements = [{"name": "token", "step": "publish", "contract_id": "secret://deployments/check-shared/api_token", "required": "true"}],',
      '        provider = "test",',
      "        component = component,",
      '        component_kind = "test",',
      '        publisher = "test",',
      '        visibility = ["PUBLIC"],',
      "    )",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(stage, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'load("//projects/deployments/check-shared:family.bzl", "check_deployment")',
      "",
      'genrule(name = "app", out = "app.txt", cmd = "printf app > $OUT")',
      'check_deployment(name = "deploy", component = ":app")',
      "",
    ].join("\n"),
  );
}
