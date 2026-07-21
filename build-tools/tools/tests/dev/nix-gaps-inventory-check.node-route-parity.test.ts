#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";
import { inspectProductionCommandSites } from "../../dev/nix-gaps-command-sites";

const scriptPath = "viberoots/build-tools/tools/dev/nix-gaps-inventory-check.ts";
const scriptSourcePath = viberootsSourcePath(scriptPath);
const exceptionsPath = "docs/handbook/nix-gaps-exceptions.json";
const commandSitePolicyPath = "docs/handbook/nix-command-site-policy.json";

const starlarkApi = `# Starlark API reference

## Index

- \`@viberoots//build-tools/node:defs.bzl\`
  - \`node_asset_stage\`
  - \`node_wasm_inline_module\`
`;

const inventoryStandaloneRoute = `# Nix gaps (public macro inventory)

## Legend

- **Nix build** means the macro calls Nix or a Nix-backed rule.
- **Buck build** means the macro produces artifacts through Buck rules and is still a migration gap.
- **Stub (artifact expected)** means the macro contract expects a build artifact, but the current implementation is still a stub.
- **Probe-only exception** means the macro is intentionally non-build and does not produce a production artifact.

## Node macros

- \`node_asset_stage\` → Nix build (\`standalone nix-calling genrule route\`).
- \`node_wasm_inline_module\` → Nix build (\`standalone nix-calling genrule route\`).

Node macro outcome classification:

| Macro | Outcome category | Current route | Notes |
| ----- | ---------------- | ------------- | ----- |
| \`node_asset_stage\` | artifact-producing | Nix build | standalone nix-calling genrule route |
| \`node_wasm_inline_module\` | artifact-producing | Nix build | standalone nix-calling genrule route |

## Exception policy (intentional non-build macros)

- none
`;

const inventoryWrapperRoute = inventoryStandaloneRoute
  .replaceAll("standalone nix-calling genrule route", "nix_node_gen wrapper route")
  .replaceAll("standalone nix-calling genrule", "nix_node_gen wrapper");

const defsStageStandalone = `def _prepare_node_nix_calling_genrule(name, kwargs, srcs, deps, labels, lockfile_label):
    return struct(kwargs = kwargs)

def node_asset_stage(name, app, assets = [], out = None, **kwargs):
    cmd = (
        nix_calling_genrule_bootstrap(
            timeout_sec = 240,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + "if [ -n \\"$VBR_NODE_ROUTE_TARGET\\" ]; then "
        + nix_action_build_selected_out_path_cmd(
            target_label = "$VBR_NODE_ROUTE_TARGET",
            timeout_var = "TIMEOUT",
        )
        + "fi; "
    )
    wiring = _prepare_node_nix_calling_genrule(
        name = name,
        kwargs = kwargs,
        srcs = [app],
        deps = [],
        labels = [],
        lockfile_label = None,
    )
    return cmd + str(wiring)

def node_wasm_inline_module(name, src, out = None, **kwargs):
    cmd = (
        nix_calling_genrule_bootstrap(
            timeout_sec = 180,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + "if [ -n \\"$VBR_NODE_ROUTE_TARGET\\" ]; then "
        + nix_action_build_selected_out_path_cmd(
            target_label = "$VBR_NODE_ROUTE_TARGET",
            timeout_var = "TIMEOUT",
        )
        + "fi; "
    )
    wiring = _prepare_node_nix_calling_genrule(
        name = name,
        kwargs = kwargs,
        srcs = [src],
        deps = [],
        labels = [],
        lockfile_label = None,
    )
    return cmd + str(wiring)
`;

const defsCoreMinimal = `def nix_node_test(name, **kwargs):
    pass
`;

const defsPublicFixture = `def node_asset_stage(name, **kwargs):
    pass

def node_wasm_inline_module(name, **kwargs):
    pass
`;

const emptyExceptions = `{
  "exceptions": [],
  "artifactRouteAllowlist": []
}
`;

async function writeRouteExceptions(tmp: string): Promise<void> {
  const source = path.join(tmp, "route-source");
  const policy = {
    schemaVersion: 1 as const,
    expectedCount: 0,
    expectedDigest: "",
    classificationRules: [
      {
        pathPattern: "^build-tools/",
        role: "non-artifact-orchestration" as const,
        justification: "Private route fixture sites exercise checker behavior only.",
      },
    ],
  };
  const actual = await inspectProductionCommandSites(source, policy);
  await fs.outputJson(
    path.join(tmp, commandSitePolicyPath),
    {
      ...policy,
      expectedCount: actual.count,
      expectedDigest: actual.digest,
    },
    { spaces: 2 },
  );
  await fs.outputFile(path.join(tmp, exceptionsPath), emptyExceptions);
}

test("nix-gaps checker accepts standalone stage/inline route when docs and implementation match", async () => {
  await runInTemp("nix-gaps-node-route-standalone-pass", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptSourcePath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), inventoryStandaloneRoute);
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs_core.bzl"),
      defsCoreMinimal,
    );
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs.bzl"),
      defsPublicFixture,
    );
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs_stage.bzl"),
      defsStageStandalone,
    );
    await writeRouteExceptions(tmp);
    await $({
      cwd: tmp,
      env: { ...process.env, VIBEROOTS_SOURCE_ROOT: path.join(tmp, "route-source") },
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath} --command-site-policy ${commandSitePolicyPath}`;
  });
});

test("nix-gaps checker rejects standalone routes that bypass the canonical selected-build helper", async () => {
  await runInTemp("nix-gaps-node-route-helper-missing", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptSourcePath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), inventoryStandaloneRoute);
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs_core.bzl"),
      defsCoreMinimal,
    );
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs.bzl"),
      defsPublicFixture,
    );
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs_stage.bzl"),
      defsStageStandalone.replaceAll(
        "nix_action_build_selected_out_path_cmd(",
        "noncanonical_selected_build(",
      ),
    );
    await writeRouteExceptions(tmp);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, VIBEROOTS_SOURCE_ROOT: path.join(tmp, "route-source") },
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath} --command-site-policy ${commandSitePolicyPath}`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /canonical|selected-build|standalone nix-calling/);
  });
});

test("nix-gaps checker fails when docs claim wrapper route but stage/inline implementation is standalone", async () => {
  await runInTemp("nix-gaps-node-route-mismatch-fail", async (tmp, $) => {
    await fs.outputFile(path.join(tmp, scriptPath), await fs.readFile(scriptSourcePath, "utf8"));
    await fs.outputFile(path.join(tmp, "docs/handbook/starlark-api.md"), starlarkApi);
    await fs.outputFile(path.join(tmp, "docs/handbook/nix-gaps.md"), inventoryWrapperRoute);
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs_core.bzl"),
      defsCoreMinimal,
    );
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs.bzl"),
      defsPublicFixture,
    );
    await fs.outputFile(
      path.join(tmp, "route-source/build-tools/node/defs_stage.bzl"),
      defsStageStandalone,
    );
    await writeRouteExceptions(tmp);
    const res = await $({
      cwd: tmp,
      stdio: "pipe",
      env: { ...process.env, VIBEROOTS_SOURCE_ROOT: path.join(tmp, "route-source") },
    })`node ${scriptPath} --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions ${exceptionsPath} --command-site-policy ${commandSitePolicyPath}`.nothrow();
    assert.notEqual(res.exitCode, 0);
    assert.match(String(res.stderr || ""), /docs\/implementation mismatch/);
  });
});
