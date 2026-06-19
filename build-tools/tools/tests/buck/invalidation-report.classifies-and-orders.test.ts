#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_AUTO_MAP_PATH,
  DEFAULT_GRAPH_PATH,
  DEFAULT_INVALIDATION_REPORT_PATH,
  DEFAULT_NODE_LOCK_INDEX_PATH,
  DEFAULT_PROVIDER_INDEX_JSON_PATH,
  workspaceProviderLabel,
} from "../../lib/workspace-state-paths";
import { runInTemp } from "../lib/test-helpers";

test("invalidation-report: stable ordering, patch scope classification, and global nix input expectation (fixture)", async () => {
  await runInTemp("invalidation-report-fixture", async (tmp, $) => {
    await fsp.mkdir(path.dirname(path.join(tmp, DEFAULT_GRAPH_PATH)), { recursive: true });
    await fsp.mkdir(path.dirname(path.join(tmp, DEFAULT_AUTO_MAP_PATH)), { recursive: true });

    const graph = {
      $schema: "https://example.com/schemas/buck-graph.schema.json",
      version: 1,
      nodes: [
        {
          name: "//projects/apps/py:bin",
          rule_type: "python_binary",
          labels: [
            "lang:python",
            "kind:bin",
            "patch_scope:importer-local",
            "lockfile:projects/apps/py/uv.lock#projects/apps/py",
          ],
          srcs: ["projects/apps/py/main.py"],
        },
        {
          name: "//projects/apps/web:bundle",
          rule_type: "node_webapp",
          labels: [
            "lang:node",
            "kind:bundle",
            "patch_scope:importer-local",
            "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
            "//.viberoots/workspace:flake.lock",
          ],
          srcs: {
            "__global_nix_inputs__/flake_lock": "//.viberoots/workspace:flake.lock",
            "__patch_inputs__/projects_apps_web_patches_node":
              "root//projects/apps/web/patches/node/demo.patch",
          },
        },
        {
          name: "//projects/libs/cpp:lib",
          rule_type: "cxx_library",
          labels: ["lang:cpp", "kind:lib", "patch_scope:package-local"],
          srcs: ["projects/libs/cpp/lib.cc", "projects/libs/cpp/patches/cpp/demo@0.0.0.patch"],
        },
        {
          name: "//projects/libs/cpp:stub",
          rule_type: "planner_stub",
          labels: ["lang:cpp", "kind:stub", "patch_scope:package-local"],
          srcs: {
            "__patch_inputs__/projects_libs_cpp_patches_cpp":
              "root//projects/libs/cpp/patches/cpp/demo@0.0.0.patch",
          },
        },
        {
          name: "//projects/libs/go:lib",
          rule_type: "go_library",
          labels: ["lang:go", "kind:lib", "patch_scope:package-local"],
          srcs: ["projects/libs/go/lib.go", "projects/libs/go/patches/go/demo@0.0.0.patch"],
        },
        {
          name: workspaceProviderLabel("lf_demo"),
          rule_type: "genrule",
          labels: ["lang:node"],
        },
      ],
    };

    await fsp.writeFile(
      path.join(tmp, DEFAULT_GRAPH_PATH),
      JSON.stringify(graph, null, 2) + "\n",
      "utf8",
    );

    const nodeLockIndex = {
      $schema: "https://example.com/schemas/node-lock-index.schema.json",
      version: 1,
      index: {
        "//projects/apps/web:bundle": "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
        "//projects/apps/py:bin": "lockfile:projects/apps/py/uv.lock#projects/apps/py",
      },
    };
    await fsp.writeFile(
      path.join(tmp, DEFAULT_NODE_LOCK_INDEX_PATH),
      JSON.stringify(nodeLockIndex, null, 2) + "\n",
      "utf8",
    );

    const providerIndex = {
      [workspaceProviderLabel("lf_demo")]: {
        kind: "node",
        key: "lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
        patch_scope: "importer-local",
      },
    };
    await fsp.writeFile(
      path.join(tmp, DEFAULT_PROVIDER_INDEX_JSON_PATH),
      JSON.stringify(providerIndex, null, 2) + "\n",
      "utf8",
    );

    await fsp.writeFile(
      path.join(tmp, DEFAULT_AUTO_MAP_PATH),
      [
        "# GENERATED FILE — DO NOT EDIT.",
        "",
        "MODULE_PROVIDERS = {",
        '    "//projects/apps/web:bundle": [',
        `        "${workspaceProviderLabel("lf_demo")}",`,
        "    ],",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await $({
      cwd: tmp,
      stdio: "pipe",
    })`node --experimental-strip-types --import ./viberoots/build-tools/tools/dev/zx-init.mjs viberoots/build-tools/tools/buck/invalidation-report.ts`;

    const reportPath = path.join(tmp, DEFAULT_INVALIDATION_REPORT_PATH);
    const txt = await fsp.readFile(reportPath, "utf8");

    // Stable ordering: targets are sorted lexicographically by normalized label.
    const idxGo = txt.indexOf("target=//projects/libs/go:lib");
    const idxCpp = txt.indexOf("target=//projects/libs/cpp:lib");
    const idxNode = txt.indexOf("target=//projects/apps/web:bundle");
    const idxPy = txt.indexOf("target=//projects/apps/py:bin");
    if ([idxGo, idxCpp, idxNode, idxPy].some((n) => n < 0)) {
      throw new Error(`expected all fixture targets to be present; got:\n${txt}`);
    }
    if (!(idxPy < idxNode && idxNode < idxCpp && idxCpp < idxGo)) {
      throw new Error(`expected stable ordering (apps/* before libs/*); got:\n${txt}`);
    }

    // Patch scope + global nix input expectation for a representative Nix-calling Node macro shape.
    const wantNodeParts = [
      "target=//projects/apps/web:bundle",
      "langs=node",
      "patch_scope=importer-local",
      "provider_model=importer-scoped",
      "lockfile_label=lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web",
      "global_nix_inputs_action_inputs_expected=true",
      "global_nix_inputs_action_inputs_observed_in=srcs(dict)/__global_nix_inputs__",
      "global_nix_inputs_labels_stamped=true",
      "importer_local_patches_action_inputs_expected=true",
      "importer_local_patches_action_inputs_observed_in=srcs(dict)/__patch_inputs__",
      `module_providers=[${workspaceProviderLabel("lf_demo")} kind=node key=lockfile:projects/apps/web/pnpm-lock.yaml#projects/apps/web patch_scope=importer-local]`,
    ];
    for (const part of wantNodeParts) {
      if (!txt.includes(part)) {
        throw new Error(`expected invalidation report to include:\n${part}\n\ngot:\n${txt}`);
      }
    }

    // Patch scope classification for representative targets (Go/C++/Python).
    const wantOtherParts = [
      "target=//projects/libs/go:lib\tlangs=go\tpatch_scope=package-local",
      "package_local_patches_action_inputs_expected=true",
      "package_local_patches_action_inputs_observed_in=srcs(list)/projects/libs/go/patches/go",
      "target=//projects/libs/cpp:lib\tlangs=cpp\tpatch_scope=package-local",
      "package_local_patches_action_inputs_observed_in=srcs(list)/projects/libs/cpp/patches/cpp",
      "target=//projects/libs/cpp:stub\tlangs=cpp\tpatch_scope=package-local",
      "package_local_patches_action_inputs_observed_in=srcs(dict)/__patch_inputs__",
      "target=//projects/apps/py:bin\tlangs=python\tpatch_scope=importer-local",
    ];
    for (const part of wantOtherParts) {
      if (!txt.includes(part)) {
        throw new Error(`expected invalidation report to include:\n${part}\n\ngot:\n${txt}`);
      }
    }
  });
});
