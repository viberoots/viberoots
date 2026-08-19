#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { $ } from "zx";
import { exportInlineGraph } from "../../buck/export-inline";
import { attrList } from "../../buck/exporter/cquery/attrs";
import { nodesFromCqueryJson } from "../../buck/exporter/cquery/nodes";
import { killBuckIsolation } from "../../dev/verify/process-control";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const sourceParentRoot = path.dirname(sourceRoot);
const parentWorkspaceRoot =
  path.basename(sourceRoot) === "viberoots" &&
  fs.existsSync(path.join(sourceParentRoot, ".buckconfig"))
    ? sourceParentRoot
    : sourceRoot;
const fixturesRoot = path.join(sourceRoot, "build-tools/tools/tests/fixtures");
const read = (relative: string) => fsp.readFile(path.join(sourceRoot, relative), "utf8");
const sourceRuleIsolation =
  String(process.env.BUCK_NESTED_ISO || "").trim() ||
  inheritedBuckIsolation("rust_tauri_mobile_metadata");
const exporterIsolation = inheritedBuckIsolation("rust_tauri_export_parity");
const cqueryIsolation = inheritedBuckIsolation("rust_tauri_export_parity_cquery");
const desktopFixtureTarget = "//build-tools/tools/tests/fixtures/rust-tauri-app:desktop";
const desktopFixtureExportTarget =
  parentWorkspaceRoot === sourceRoot
    ? desktopFixtureTarget
    : "viberoots//build-tools/tools/tests/fixtures/rust-tauri-app:desktop";
const desktopFixtureGraphLabel = desktopFixtureTarget;
const expectedDesktopTauriTarget = {
  family: "tauri",
  platform: "desktop-darwin",
  artifactKind: "macos-app",
  bundleIdentifier: "",
  packageName: "",
  signingMode: "adhoc-platform",
  deploymentEligibility: "not-eligible",
};

after(async () => await killBuckIsolation(process.cwd(), sourceRuleIsolation));
after(async () => await killBuckIsolation(process.cwd(), exporterIsolation));
after(async () => await killBuckIsolation(process.cwd(), cqueryIsolation));

test("tauri_app exports typed desktop metadata", async () => {
  const result = await $({ cwd: sourceRoot, stdio: "pipe" })`
    buck2 --isolation-dir ${sourceRuleIsolation} uquery --json \
      --output-attribute labels --output-attribute tauri_target ${desktopFixtureTarget}
  `;
  const contract = String(result.stdout);
  for (const expected of [
    "tauri-platform:desktop-darwin",
    "tauri-artifact:macos-app",
    '"artifactKind": "macos-app"',
    '"deploymentEligibility": "not-eligible"',
    '"family": "tauri"',
    '"platform": "desktop-darwin"',
    '"signingMode": "adhoc-platform"',
  ]) {
    assert.match(contract, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Tauri metadata is identical through cquery and inline graph exporters", async () => {
  await runInTemp("tauri-export-parity", async (tmp) => {
    try {
      const inlineGraphPath = path.join(tmp, "inline-graph.json");
      const env = {
        ...process.env,
        BUCK_TEST_SRC: parentWorkspaceRoot,
        WORKSPACE_ROOT: parentWorkspaceRoot,
        BUCK_ISOLATION_DIR_EXPORTER: exporterIsolation,
      };
      const attrFlags = attrList.flatMap((attr) => ["--output-attribute", attr]);
      const cquery = await $({ cwd: parentWorkspaceRoot, env, stdio: "pipe" })`
      buck2 --isolation-dir ${cqueryIsolation} \
        cquery --target-platforms prelude//platforms:default ${desktopFixtureExportTarget} --json ${attrFlags}
    `;
      await exportInlineGraph({
        workspaceRoot: parentWorkspaceRoot,
        outPath: inlineGraphPath,
        target: desktopFixtureExportTarget,
        includeTargetPlatforms: true,
        normalizeLabels: true,
        env,
      });
      const cqueryNodes = nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "{}")));
      const inlineGraph = JSON.parse(await fsp.readFile(inlineGraphPath, "utf8"));
      const cqueryNode = cqueryNodes.find((node: any) => node.name === desktopFixtureGraphLabel);
      const inlineNode = inlineGraph.nodes.find(
        (node: any) => node.name === desktopFixtureGraphLabel,
      );
      assert.deepEqual(cqueryNode?.tauri_target, expectedDesktopTauriTarget);
      assert.deepEqual(inlineNode?.tauri_target, expectedDesktopTauriTarget);
      assert.deepEqual(inlineNode.tauri_target, cqueryNode.tauri_target);
    } finally {
      await Promise.all(
        [cqueryIsolation, exporterIsolation].map(
          (isolationDir) =>
            $({
              cwd: parentWorkspaceRoot,
              stdio: "ignore",
              reject: false,
              nothrow: true,
            })`buck2 --isolation-dir ${isolationDir} kill`,
        ),
      );
    }
  });
});

test("tauri_app rejects malformed or unsupported typed mobile metadata", async () => {
  await runInTemp("rust-tauri-mobile-metadata-contracts", async (tmp, tempShell) => {
    const app = path.join(tmp, "projects", "fixtures", "rust-tauri-app");
    await fsp.cp(path.join(fixturesRoot, "rust-tauri-app"), app, { recursive: true });
    const targetsPath = path.join(app, "TARGETS");
    const baseTargets = await fsp.readFile(targetsPath, "utf8");
    const baseDeclaration = /tauri_app\([\s\S]*?\n\)/.exec(baseTargets)?.[0] || "";
    assert.ok(baseDeclaration.includes('name = "desktop"'));
    const query = async () =>
      await tempShell({
        cwd: tmp,
        stdio: "pipe",
        reject: false,
        nothrow: true,
      })`buck2 cquery --target-platforms //:no_cgo //projects/fixtures/rust-tauri-app:desktop`;

    for (const [replacement, expected] of [
      [
        'tauri_target_platform = "ios",\n    tauri_artifact_kind = "ios-simulator-bundle"',
        "no reviewed mobile builder",
      ],
      ['tauri_artifact_kind = "android-debug-apk"', "artifact kind android-debug-apk"],
      ['tauri_signing_mode = "release-signed"', "desktop-darwin currently supports"],
      ['tauri_deployment_eligibility = "release-admitted"', "only release-signed artifacts"],
      ['tauri_bundle_identifier = "not valid"', "reverse-DNS identifier"],
      ['tauri_package_name = "not valid"', "reverse-DNS identifier"],
    ]) {
      const changedDeclaration = baseDeclaration.replace(
        'frontend_dist = ":frontend",',
        `frontend_dist = ":frontend",\n    ${replacement},`,
      );
      await fsp.writeFile(targetsPath, baseTargets.replace(baseDeclaration, changedDeclaration));
      const result = await query();
      assert.notEqual(result.exitCode, 0);
      assert.match(String(result.stderr || result.stdout), new RegExp(expected));
    }
  });
});

test("Tauri mobile route inventory stays separate from active public macros", async () => {
  const [contract, planner, graph, manifest, langs, schema, routeChecker, api, gaps] =
    await Promise.all([
      read("build-tools/rust/private/tauri_contract.bzl"),
      read("build-tools/tools/nix/planner/rust-tauri.nix"),
      read("build-tools/tools/nix/graph-generator.nix"),
      read("build-tools/tools/nix/planner/manifest.nix"),
      read("build-tools/tools/nix/langs.json"),
      read("build-tools/tools/dev/langs.schema.json"),
      read("build-tools/tools/dev/nix-gaps-inventory-rust-routes.ts"),
      read("docs/handbook/starlark-api.md"),
      read("docs/handbook/nix-gaps.md"),
    ]);
  assert.match(contract, /tauri-platform:desktop-darwin/);
  assert.match(contract, /"tauri_target": tauri_target/);
  assert.match(planner, /typedTargetFor/);
  assert.match(planner, /tauri_target metadata/);
  assert.match(graph, /tauriTarget/);
  assert.match(manifest, /tauriTarget/);
  assert.match(manifest, /bundleIdentifier/);
  assert.match(manifest, /packageName/);
  assert.match(schema, /plannedRoutes/);
  assert.match(routeChecker, /expectedPlannedRoutes/);
  assert.match(routeChecker, /must stay out of active public macros/);

  const rustLang = JSON.parse(langs).languages.find((language: any) => language.id === "rust");
  assert.deepEqual(
    rustLang.plannedRoutes.map((route: any) => [route.macro, route.state]),
    [
      ["tauri_android_app", "loadable-disabled"],
      ["tauri_ios_app", "loadable-disabled"],
      ["tauri_mobile_suite", "loadable-disabled"],
    ],
  );
  assert.match(api, /## Planned Route Inventory/);
  assert.match(api, /tauri_android_app` \(`loadable-disabled`\)/);
  assert.match(gaps, /loadable-disabled` route inventory/);
});
