#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("runInTemp locks a filtered viberoots input instead of the live source root", async () => {
  const source = (
    await Promise.all(
      [
        "filtered-inputs.ts",
        "flake-rewrite.ts",
        "nix-support.ts",
        "scratch-runner.ts",
        "seeded-setup.ts",
        "seeded-runner.ts",
        "dev-env.ts",
        "runtime-env.ts",
        "cleanup.ts",
      ].map((name) =>
        fsp.readFile(
          viberootsSourcePath(`build-tools/tools/tests/lib/test-helpers/run-in-temp/${name}`),
          "utf8",
        ),
      ),
    )
  ).join("\n");
  const materializer = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/filtered-flake-viberoots-input.ts"),
    "utf8",
  );
  assert.match(
    materializer,
    /args: \["flake", "prefetch", "--json", "--no-use-registries", `path:\$\{canonical\}`\]/,
  );
  assert.match(source, /materializeFilteredViberootsSource\(inputRoot\)/);
  assert.match(source, /prepareFilteredViberootsInput\(activeViberootsRoot\)/);
  assert.match(source, /filteredFlakeRsyncExcludeArgs\(\)/);
  assert.match(source, /defaultFilteredFlakeSnapshotRelPaths\(\)/);
  assert.match(source, /rel === "\.viberoots" \|\| rel\.startsWith\("\.viberoots\/"\)/);
  assert.match(source, /VIBEROOTS_FLAKE_INPUT_ROOT = viberootsInput\.storePath/);
  assert.match(source, /rewriteTempViberootsInput\(tmp, viberootsInput\)/);
  assert.match(source, /type TempViberootsRoles = \{/);
  assert.match(source, /commandSourceRoot: viberootsSourceRoot/);
  assert.match(source, /consumerSnapshotRoot: consumerSnapshot\.root/);
  assert.match(source, /flakeInput: viberootsInput/);
  assert.match(source, /prepareFilteredConsumerSnapshot\(tmp\)/);
  assert.match(source, /VBR_FILTERED_FLAKE_SNAPSHOT: "1"/);
  assert.match(source, /VBR_PNPM_FILTERED_SNAPSHOT_ROOT: roles\.consumerSnapshotRoot/);
  assert.match(source, /flakeRef: `path:\$\{consumerFlakeRoot\}`/);
  assert.match(source, /repoRoot: roles\.commandSourceRoot/);
  assert.match(source, /path\.join\(roles\.consumerSnapshotRoot, "pnpm-lock\.yaml"\)/);
  assert.match(source, /const fixedStore = hasRootImporter/);
  assert.match(source, /attrPath: "pnpm-store"/);
  assert.match(source, /nix develop \$\{`path:\$\{consumerFlakeRoot\}`\}/);
  assert.match(source, /VIBEROOTS_FLAKE_INPUT_ROOT: roles\.flakeInput\.storePath/);
  assert.doesNotMatch(source, /#pnpm-store[^\n]*flakeInput\.storePath/);
  assert.doesNotMatch(source, /pnpm-store\.viberoots/);
  assert.doesNotMatch(source, /flakeRef: `path:\$\{roles\.flakeInput\.storePath\}`/);
  assert.doesNotMatch(
    source,
    /path\.join\(tmp, "\.viberoots", "workspace", "viberoots-flake-input"\)/,
  );
  assert.doesNotMatch(source, /nix flake metadata/);
  assert.doesNotMatch(source, /nix hash path/);
  assert.doesNotMatch(source, /--override-input/);
  assert.doesNotMatch(source, /nix develop \$\{`path:\$\{roles\.flakeInput\.storePath\}`\}/);
  assert.doesNotMatch(source, /rewriteTempViberootsInput\(tmp, activeViberootsRoot\)/);
  for (const generatedPath of [
    '".viberoots/current"',
    '".viberoots/workspace/prelude"',
    '"viberoots/prelude"',
  ]) {
    assert.ok(source.includes(generatedPath));
  }
  assert.ok(
    source.indexOf("reconcileTempDependencyInputs(tmp") <
      source.indexOf("prepareFilteredConsumerSnapshot(tmp)"),
    "consumer snapshot must be created after dependency reconciliation",
  );
  assert.doesNotMatch(source, /cachedDevEnvExport/);
  const bodyIndex = source.lastIndexOf("runInTemp testBody");
  const processCleanupIndex = source.lastIndexOf('timeAsync("temp process cleanup"');
  const snapshotCleanupIndex = source.indexOf("await consumerSnapshot?.cleanup()");
  assert.ok(bodyIndex >= 0, "runInTemp body marker must exist");
  assert.ok(processCleanupIndex >= 0, "temp process cleanup marker must exist");
  assert.ok(snapshotCleanupIndex >= 0, "consumer snapshot cleanup marker must exist");
  assert.ok(
    bodyIndex < processCleanupIndex && processCleanupIndex < snapshotCleanupIndex,
    "consumer snapshot must remain alive through the callback and temp process cleanup",
  );
  assert.ok(
    source.indexOf("return await withAsyncCleanup(") >= 0 &&
      source.indexOf("return await withAsyncCleanup(") <
        source.indexOf("prepareFilteredConsumerSnapshot(tmp)"),
    "consumer snapshot cleanup must cover snapshot preparation and every later setup step",
  );
  assert.match(source, /repoNodeBinDirectories\(process\.cwd\(\), exportEnv\)/);
  assert.match(source, /runAsyncCleanupSteps\(steps\)/);
  assert.match(source, /await consumerSnapshot\?\.cleanup\(\)/);
});
