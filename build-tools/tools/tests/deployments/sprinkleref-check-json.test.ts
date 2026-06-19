#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { $ } from "zx";
import { runSprinkleRefCheck } from "../../deployments/sprinkleref-check";
import { runInTemp } from "../lib/test-helpers";

test("repo JSON includes stable status, scheme, sensitivity, location, category, and backend", async () => {
  const dir = await gitRepo("sprinkleref-json-repo-");
  const ref = "secret://deployments/json/api_token";
  const store = path.join(dir, "store.json");
  const config = path.join(dir, "resolver.json");
  await fs.writeFile(path.join(dir, "contracts.txt"), `${ref}\n`);
  await fs.writeFile(store, `${JSON.stringify({ [ref]: "hidden" })}\n`);
  await fs.writeFile(
    config,
    `${JSON.stringify({
      version: 1,
      defaultCategory: "bootstrap",
      categories: { bootstrap: { backend: "local-file", file: store } },
    })}\n`,
  );
  await $({ cwd: dir })`git add contracts.txt`.quiet();
  const report = await jsonInDir(dir, ["--check", "--config", config, "--format", "json"]);
  assert.deepEqual(
    pick(report.refs[0], [
      "ref",
      "scheme",
      "sensitive",
      "status",
      "scope",
      "locations",
      "requiredBy",
      "category",
    ]),
    {
      ref,
      scheme: "secret",
      sensitive: true,
      status: "present",
      scope: "repo",
      locations: ["contracts.txt:1"],
      requiredBy: [],
      category: "bootstrap",
    },
  );
  assert.match(report.refs[0].backend, /local-file/);
});

test("target JSON includes stable requiredBy and direct or dependency scope", async () => {
  await runInTemp("sprinkleref-check-json-target", async (tmp) => {
    await writeDeploymentTargets(tmp);
    const config = path.join(tmp, "resolver.json");
    await fs.writeFile(
      config,
      `${JSON.stringify({
        version: 1,
        defaultCategory: "main",
        categories: { main: { backend: "local-file", file: path.join(tmp, "store.json") } },
      })}\n`,
    );
    const report = await jsonInDir(tmp, [
      "--check",
      "--target",
      "//projects/deployments/json-demo:deploy",
      "--config",
      config,
      "--format",
      "json",
    ]);
    const byRef = new Map(report.refs.map((entry: any) => [entry.ref, entry]));
    assert.deepEqual(
      pick(byRef.get("secret://deployments/json-demo/api_token"), [
        "scheme",
        "sensitive",
        "status",
        "scope",
        "requiredBy",
      ]),
      {
        scheme: "secret",
        sensitive: true,
        status: "missing",
        scope: "direct",
        requiredBy: ["//projects/deployments/json-demo:deploy"],
      },
    );
    assert.deepEqual(
      pick(byRef.get("runtime://deployments/json-demo/app_id"), [
        "scheme",
        "sensitive",
        "status",
        "scope",
        "requiredBy",
      ]),
      {
        scheme: "runtime",
        sensitive: false,
        status: "declared",
        scope: "dependency",
        requiredBy: ["//projects/deployments/json-demo:component"],
      },
    );
    assert.match(byRef.get("config://deployments/json-demo/public_url").locations[0], /TARGETS:/);
  });
});

test("repo JSON reports active local overrides with secret-like values redacted", async () => {
  const dir = await gitRepo("sprinkleref-json-overrides-");
  await fs.mkdir(path.join(dir, "projects/config"), { recursive: true });
  await fs.writeFile(path.join(dir, "contracts.txt"), "");
  await fs.writeFile(
    path.join(dir, "projects/config/shared.json"),
    `${JSON.stringify({
      schemaVersion: "viberoots-project-config@1",
      sprinkleref: {
        version: 1,
        defaultCategory: "main",
        categories: { main: { backend: "local-file", file: path.join(dir, "shared.json") } },
      },
      values: { control: { token: "shared-secret", region: "us-east-1" } },
    })}\n`,
  );
  await fs.writeFile(
    path.join(dir, "projects/config/local.json"),
    `${JSON.stringify({
      activeRuntimeHost: "local-file",
      values: { control: { token: "local-secret", region: "us-west-2" } },
    })}\n`,
  );
  await $({ cwd: dir })`git add contracts.txt`.quiet();
  const report = await jsonInDir(dir, ["--check", "--format", "json"]);
  assert.deepEqual(report.localOverrides, [
    { path: "values.control.region", sharedValue: "us-east-1", localValue: "us-west-2" },
    {
      path: "values.control.token",
      sharedValue: "<redacted>",
      localValue: "<redacted>",
    },
  ]);
});

function pick(value: any, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

async function jsonInDir(dir: string, argv: string[]): Promise<any> {
  return await runInDir(dir, async () => {
    let output = "";
    await runSprinkleRefCheck({ argv, stdout: (text) => (output = text) });
    return JSON.parse(output);
  });
}

async function writeDeploymentTargets(tmp: string): Promise<void> {
  const dir = path.join(tmp, "projects", "deployments", "json-demo");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "TARGETS"),
    [
      'load("@prelude//:rules.bzl", "genrule")',
      'load("@viberoots//build-tools/deployments:metadata_rules.bzl", "deployment_target")',
      "",
      'genrule(name = "app", out = "app.txt", cmd = "printf app > $OUT")',
      "deployment_target(",
      '    name = "component", provider = "test", component = ":app", component_kind = "test", publisher = "test",',
      '    runtime_config_requirements = [{"name": "app_id", "step": "publish", "contract_id": "runtime://deployments/json-demo/app_id", "required": "true"}],',
      ")",
      "deployment_target(",
      '    name = "deploy", provider = "test", component = ":component", component_kind = "test", publisher = "test",',
      '    secret_requirements = [{"name": "api_token", "step": "publish", "contract_id": "secret://deployments/json-demo/api_token", "required": "true"}],',
      '    runtime_config_requirements = [{"name": "public_url", "step": "publish", "contract_id": "config://deployments/json-demo/public_url", "required": "true"}],',
      ")",
      "",
    ].join("\n"),
  );
}

async function gitRepo(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await $({ cwd: dir })`git init`.quiet();
  return dir;
}

async function runInDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const old = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(old);
  }
}
