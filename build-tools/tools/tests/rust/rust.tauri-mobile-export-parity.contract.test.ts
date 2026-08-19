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
const parentRoot =
  path.basename(sourceRoot) === "viberoots" &&
  fs.existsSync(path.join(path.dirname(sourceRoot), ".buckconfig"))
    ? path.dirname(sourceRoot)
    : sourceRoot;
const cqueryIsolation = inheritedBuckIsolation("rust_tauri_mobile_export_parity_cquery");
const exporterIsolation = inheritedBuckIsolation("rust_tauri_mobile_export_parity_exporter");
after(async () => await killBuckIsolation(process.cwd(), cqueryIsolation));
after(async () => await killBuckIsolation(process.cwd(), exporterIsolation));
const targets = [
  [
    "//build-tools/tools/tests/fixtures/rust-tauri-app:private_mobile_ios_helper",
    {
      family: "tauri",
      platform: "ios",
      artifactKind: "ios-simulator-bundle",
      bundleIdentifier: "dev.viberoots.fixture",
      packageName: "",
      signingMode: "unsigned-local",
      deploymentEligibility: "not-eligible",
    },
  ],
  [
    "//build-tools/tools/tests/fixtures/rust-tauri-app:private_mobile_android_helper",
    {
      family: "tauri",
      platform: "android",
      artifactKind: "android-debug-apk",
      bundleIdentifier: "",
      packageName: "dev.viberoots.fixture",
      signingMode: "debug-local",
      deploymentEligibility: "not-eligible",
    },
  ],
] as const;

test("private mobile helper metadata matches between cquery and inline export", async () => {
  await runInTemp("tauri-mobile-private-export-parity", async () => {
    const env = {
      ...process.env,
      BUCK_ISOLATION_DIR_EXPORTER: exporterIsolation,
      BUCK_TEST_SRC: sourceRoot,
      WORKSPACE_ROOT: sourceRoot,
    };
    const queryTargets = targets.map(([label]) =>
      parentRoot === sourceRoot ? label : `viberoots${label}`,
    );
    const attrFlags = attrList.flatMap((attr) => ["--output-attribute", attr]);
    const query = `set(${queryTargets.join(" ")})`;
    const cquery = await $({ cwd: parentRoot, env, stdio: "pipe" })`
      buck2 --isolation-dir ${cqueryIsolation} cquery --target-platforms prelude//platforms:default ${query} --json ${attrFlags}
    `;
    const cqueryNodes = nodesFromCqueryJson(JSON.parse(String(cquery.stdout || "{}")));
    const inlineGraphPath = path.join(
      parentRoot,
      ".viberoots/workspace/buck/test-logs/inline-mobile-graph.json",
    );
    await exportInlineGraph({
      workspaceRoot: parentRoot,
      outPath: inlineGraphPath,
      target: query,
      includeTargetPlatforms: true,
      normalizeLabels: true,
      env,
    });
    const inlineGraph = JSON.parse(await fsp.readFile(inlineGraphPath, "utf8"));
    const inlineNodes = inlineGraph.nodes || [];

    for (const [label, expected] of targets) {
      const cqueryNode = cqueryNodes.find((item: any) => item.name === label);
      const inlineNode = inlineNodes.find((item: any) => item.name === label);
      assert.deepEqual(cqueryNode?.tauri_target, expected);
      assert.deepEqual(inlineNode?.tauri_target, expected);
      assert.deepEqual(inlineNode?.tauri_target, cqueryNode?.tauri_target);
    }
  });
});
