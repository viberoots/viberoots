#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeSelectedCppPackageClosure,
  graphNodesFromJson,
  selectedCppSnapshotRelPaths,
} from "../../dev/nix-build-filtered-flake-lib.ts";

test("selected cpp filtered-flake snapshots follow the target package closure", () => {
  const graph = [
    {
      name: "root//projects/apps/demo:demo (config//platforms:default#hash)",
      deps: [
        "//projects/libs/core:core",
        "root//projects/libs/math:headers (config//platforms:default#hash)",
        "//third_party/providers:nix_pkgs_zlib",
      ],
    },
    {
      name: "//projects/libs/core:core",
      deps: ["//projects/libs/math:headers"],
    },
    {
      name: "//projects/libs/math:headers",
      deps: [],
    },
    {
      name: "//third_party/providers:nix_pkgs_zlib",
      deps: [],
    },
  ];

  const packagePaths = computeSelectedCppPackageClosure(
    graphNodesFromJson(graph),
    "//projects/apps/demo:demo",
  );
  assert.deepEqual(packagePaths, [
    "projects/apps/demo",
    "projects/libs/core",
    "projects/libs/math",
    "third_party/providers",
  ]);

  const snapshotRelPaths = selectedCppSnapshotRelPaths(packagePaths);
  assert.deepEqual(snapshotRelPaths.slice(0, 6), [
    ".npmrc",
    "flake.lock",
    "flake.nix",
    "gomod2nix.toml",
    "package.json",
    "pnpm-lock.yaml",
  ]);
  assert.ok(
    snapshotRelPaths.includes("build-tools") &&
      snapshotRelPaths.includes("prelude") &&
      snapshotRelPaths.includes("toolchains"),
    "expected selected cpp snapshot to retain shared flake infrastructure roots",
  );
  assert.ok(
    snapshotRelPaths.includes("projects/apps/demo") &&
      snapshotRelPaths.includes("projects/libs/core") &&
      snapshotRelPaths.includes("projects/libs/math"),
    "expected selected cpp snapshot to retain target package closure paths",
  );
  assert.ok(
    !snapshotRelPaths.includes("projects/apps/unrelated"),
    "selected cpp snapshot should not carry unrelated project packages",
  );
});
