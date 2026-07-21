import assert from "node:assert/strict";
import {
  computeSelectedCppPackageClosure,
  graphNodesFromJson,
  selectedCppSnapshotRelPaths,
  selectedCppSnapshotRsyncSources,
} from "../../dev/nix-build-filtered-flake-lib";

export function assertSelectedCppSnapshotContract(): void {
  const graph = [
    {
      name: "root//projects/apps/demo:demo (config//platforms:default#hash)",
      deps: [
        "//projects/libs/core:core",
        "root//projects/libs/math:headers (config//platforms:default#hash)",
        "//third_party/providers:nix_pkgs_zlib",
      ],
    },
    { name: "//projects/libs/core:core", deps: ["//projects/libs/math:headers"] },
    { name: "//projects/libs/math:headers", deps: [] },
    { name: "//third_party/providers:nix_pkgs_zlib", deps: [] },
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

  const paths = selectedCppSnapshotRelPaths(packagePaths);
  assert.deepEqual(paths.slice(0, 6), [
    ".npmrc",
    "flake.lock",
    "flake.nix",
    "gomod2nix.toml",
    "package.json",
    "pnpm-lock.yaml",
  ]);
  assert.ok(
    paths.includes("build-tools") && paths.includes("toolchains") && paths.includes("viberoots"),
    "expected selected cpp snapshot to retain registry, planner, and shared flake roots",
  );
  assert.ok(
    !paths.includes("prelude"),
    "generated root prelude must not enter filtered Nix source snapshots",
  );
  assert.ok(
    paths.includes("projects/apps/demo") &&
      paths.includes("projects/libs/core") &&
      paths.includes("projects/libs/math"),
    "expected selected cpp snapshot to retain target package closure paths",
  );
  assert.ok(
    !paths.includes("projects/apps/unrelated"),
    "selected cpp snapshot should not carry unrelated project packages",
  );
  assert.deepEqual(selectedCppSnapshotRsyncSources(paths).slice(0, 3), [
    "./.npmrc",
    "./flake.lock",
    "./flake.nix",
  ]);
}
