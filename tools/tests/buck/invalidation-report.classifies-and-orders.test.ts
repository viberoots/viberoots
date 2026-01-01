#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("invalidation-report: stable ordering, patch scope classification, and global nix input expectation (fixture)", async () => {
  await runInTemp("invalidation-report-fixture", async (tmp, $) => {
    await fsp.mkdir(path.join(tmp, "tools", "buck"), { recursive: true });
    await fsp.mkdir(path.join(tmp, "third_party", "providers"), { recursive: true });

    const graph = {
      $schema: "https://example.com/schemas/buck-graph.schema.json",
      version: 1,
      nodes: [
        {
          name: "//apps/py:bin",
          rule_type: "python_binary",
          labels: [
            "lang:python",
            "kind:bin",
            "patch_scope:importer-local",
            "lockfile:apps/py/uv.lock#apps/py",
          ],
          srcs: ["apps/py/main.py"],
        },
        {
          name: "//apps/web:bundle",
          rule_type: "node_webapp",
          labels: [
            "lang:node",
            "kind:bundle",
            "patch_scope:importer-local",
            "lockfile:apps/web/pnpm-lock.yaml#apps/web",
            "//:flake.lock",
          ],
          srcs: {
            "__global_nix_inputs__/flake_lock": "//:flake.lock",
            "__patch_inputs__/apps_web_patches_node": "root//apps/web/patches/node/demo.patch",
          },
        },
        {
          name: "//libs/cpp:lib",
          rule_type: "cxx_library",
          labels: ["lang:cpp", "kind:lib", "patch_scope:package-local"],
          srcs: ["libs/cpp/lib.cc", "libs/cpp/patches/cpp/demo@0.0.0.patch"],
        },
        {
          name: "//libs/go:lib",
          rule_type: "go_library",
          labels: ["lang:go", "kind:lib", "patch_scope:package-local"],
          srcs: ["libs/go/lib.go", "libs/go/patches/go/demo@0.0.0.patch"],
        },
        {
          name: "//third_party/providers:lf_demo",
          rule_type: "genrule",
          labels: ["lang:node"],
        },
      ],
    };

    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "graph.json"),
      JSON.stringify(graph, null, 2) + "\n",
      "utf8",
    );

    const nodeLockIndex = {
      $schema: "https://example.com/schemas/node-lock-index.schema.json",
      version: 1,
      index: {
        "//apps/web:bundle": "lockfile:apps/web/pnpm-lock.yaml#apps/web",
        "//apps/py:bin": "lockfile:apps/py/uv.lock#apps/py",
      },
    };
    await fsp.writeFile(
      path.join(tmp, "tools", "buck", "node-lock-index.json"),
      JSON.stringify(nodeLockIndex, null, 2) + "\n",
      "utf8",
    );

    const providerIndex = {
      "//third_party/providers:lf_demo": {
        kind: "node",
        key: "lockfile:apps/web/pnpm-lock.yaml#apps/web",
        patch_scope: "importer-local",
      },
    };
    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "provider_index.json"),
      JSON.stringify(providerIndex, null, 2) + "\n",
      "utf8",
    );

    await fsp.writeFile(
      path.join(tmp, "third_party", "providers", "auto_map.bzl"),
      [
        "# GENERATED FILE — DO NOT EDIT.",
        "",
        "MODULE_PROVIDERS = {",
        '    "//apps/web:bundle": [',
        '        "//third_party/providers:lf_demo",',
        "    ],",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    await $({
      cwd: tmp,
      stdio: "pipe",
    })`node --experimental-strip-types --import ./tools/dev/zx-init.mjs tools/buck/invalidation-report.ts`;

    const reportPath = path.join(tmp, "tools", "buck", "invalidation-report.txt");
    const txt = await fsp.readFile(reportPath, "utf8");

    // Stable ordering: targets are sorted lexicographically by normalized label.
    const idxGo = txt.indexOf("target=//libs/go:lib");
    const idxCpp = txt.indexOf("target=//libs/cpp:lib");
    const idxNode = txt.indexOf("target=//apps/web:bundle");
    const idxPy = txt.indexOf("target=//apps/py:bin");
    if ([idxGo, idxCpp, idxNode, idxPy].some((n) => n < 0)) {
      throw new Error(`expected all fixture targets to be present; got:\n${txt}`);
    }
    if (!(idxPy < idxNode && idxNode < idxCpp && idxCpp < idxGo)) {
      throw new Error(`expected stable ordering (apps/* before libs/*); got:\n${txt}`);
    }

    // Patch scope + global nix input expectation for a representative Nix-calling Node macro shape.
    const wantNodeParts = [
      "target=//apps/web:bundle",
      "langs=node",
      "patch_scope=importer-local",
      "provider_model=importer-scoped",
      "lockfile_label=lockfile:apps/web/pnpm-lock.yaml#apps/web",
      "global_nix_inputs_action_inputs_expected=true",
      "global_nix_inputs_action_inputs_observed_in=srcs(dict)/__global_nix_inputs__",
      "global_nix_inputs_labels_stamped=true",
      "importer_local_patches_action_inputs_expected=true",
      "importer_local_patches_action_inputs_observed_in=srcs(dict)/__patch_inputs__",
      "module_providers=[//third_party/providers:lf_demo kind=node key=lockfile:apps/web/pnpm-lock.yaml#apps/web patch_scope=importer-local]",
    ];
    for (const part of wantNodeParts) {
      if (!txt.includes(part)) {
        throw new Error(`expected invalidation report to include:\n${part}\n\ngot:\n${txt}`);
      }
    }

    // Patch scope classification for representative targets (Go/C++/Python).
    const wantOtherParts = [
      "target=//libs/go:lib\tlangs=go\tpatch_scope=package-local",
      "package_local_patches_action_inputs_expected=true",
      "package_local_patches_action_inputs_observed_in=srcs(list)/libs/go/patches/go",
      "target=//libs/cpp:lib\tlangs=cpp\tpatch_scope=package-local",
      "package_local_patches_action_inputs_observed_in=srcs(list)/libs/cpp/patches/cpp",
      "target=//apps/py:bin\tlangs=python\tpatch_scope=importer-local",
    ];
    for (const part of wantOtherParts) {
      if (!txt.includes(part)) {
        throw new Error(`expected invalidation report to include:\n${part}\n\ngot:\n${txt}`);
      }
    }
  });
});
