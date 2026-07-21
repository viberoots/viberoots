import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("stale glue reconciliation explicitly regenerates the workspace graph", () => {
  const installGlue = read("build-tools/tools/dev/install/glue.ts");
  const pipeline = read("build-tools/tools/buck/glue-pipeline.ts");
  const isolation = read("build-tools/tools/dev/dev-build/isolation.ts");
  const handoff = read("build-tools/tools/dev/buck-global-input-handoff.ts");
  const registration = read("build-tools/tools/lib/project-enforcement-registration.ts");

  assert.match(
    installGlue,
    /label: "glue-pipeline",\s+script: buildToolPath\([^\n]+"tools\/buck\/glue-pipeline\.ts"\),\s+args: \["--run-pipeline", "--force-graph", "--defer-fingerprint"\]/,
  );
  assert.match(pipeline, /getFlagBool\("run-pipeline"\)/);
  assert.match(
    pipeline,
    /const toolSourceRoot = opts\.toolSourceRoot \|\| executingToolSourceRoot\(\)/,
  );
  assert.doesNotMatch(pipeline, /const toolSourceRoot = opts\.toolSourceRoot \|\| repoRoot/);
  assert.match(pipeline, /forceGraph: getFlagBool\("force-graph"\)/);
  assert.match(pipeline, /publishFingerprint: !getFlagBool\("defer-fingerprint"\)/);
  assert.match(pipeline, /if \(opts\.publishFingerprint !== false\) await writeGlueFingerprint/);
  assert.match(pipeline, /await refreshGraph\(!!opts\.forceGraph\)/);
  assert.match(
    pipeline,
    /if \(opts\.forceGraph && autoMapMode !== "skip"\) \{[\s\S]*await refreshGraph\(true\)/,
  );
  assert.match(
    pipeline,
    /syncScript[\s\S]*await runNodeWithZx\([\s\S]*if \(opts\.forceGraph\) await handoffChangedGlobalInputConsumers\(repoRoot, env\)[\s\S]*reconcile graph after auto-map[\s\S]*await refreshGraph\(true\)/,
  );
  assert.doesNotMatch(pipeline, /forceGraph\?: true/);
  assert.doesNotMatch(
    installGlue,
    /--show-full-output|materialize reconciled global action inputs/,
  );
  assert.match(handoff, /changedGraphConsumerIsolationNames\(workspaceRoot, baseEnv\)/);
  assert.match(handoff, /buildArtifactEnvironment\(/);
  assert.match(
    handoff,
    /stateRoot = path\.join\(workspaceRoot, "buck-out", "tmp", "artifact-environment"\)/,
  );
  assert.match(handoff, /BUCK2_REAL_HOME: path\.join\(stateRoot, "home"\)/);
  assert.match(handoff, /HOME: baseEnv\.BUCK2_REAL_HOME \|\| baseEnv\.HOME/);
  assert.match(
    handoff,
    /request\.name === sharedDevBuildIsolationName\(workspaceRoot\) \? artifactEnv : callerEnv/,
  );
  assert.match(isolation, /sharedDevBuildIsolationName\(workspaceRoot\)/);
  assert.match(isolation, /sharedExporterIsolationName\(workspaceRoot\)/);
  assert.match(isolation, /String\(env\.BUCK_ISOLATION_DIR \|\| ""\)\.trim\(\)/);
  assert.match(isolation, /String\(env\.BUCK_NESTED_ISO \|\| ""\)\.trim\(\)/);
  assert.match(handoff, /await waitForIsolationExit\(workspaceRoot, request\.name\)/);
  assert.match(handoff, /buckIsolationProcessPidsFromLines/);
  assert.match(handoff, /process\.kill\(pid, "SIGKILL"\)/);
  assert.match(
    installGlue,
    /globalInputsAfter !== priorGlobalInputs[\s\S]*await handoffChangedGlobalInputConsumers\(wsRoot\)/,
  );
  assert.match(
    installGlue,
    /if \(freshness\.fresh\) \{[\s\S]*globalNixInputFingerprint\(wsRoot\)[\s\S]*globalInputsAfter !== priorGlobalInputs[\s\S]*await handoffChangedGlobalInputConsumers\(wsRoot\)[\s\S]*return/,
  );
  assert.match(
    installGlue,
    /await handoffChangedGlobalInputConsumers\(wsRoot\);[\s\S]*await writeGlueFingerprint\(wsRoot\)/,
  );
  assert.match(pipeline, /await ensureWorkspaceBuckStatePackage\(repoRoot\)/);
  assert.match(registration, /const graphOutput = graphDigest \? `graph\.\$\{graphDigest\}\.json`/);
  assert.match(
    registration,
    /export_file\(name = "graph\.json", src = "graph\.json", out = \$\{JSON\.stringify\(graphOutput\)\}/,
  );
  const filteredBuild = read("build-tools/tools/dev/nix-build-filtered-flake.ts");
  const preparation = read("build-tools/tools/dev/nix-build-filtered-flake-preparation.ts");
  assert.match(
    filteredBuild,
    /copyWorkspaceGraphIntoSnapshot\(\s*root,\s*snapDir,\s*declaredGraphPath,\s*\)/,
  );
  assert.match(preparation, /\[declaredGraphPath\]/);
  assert.doesNotMatch(preparation, /process\.env\.BUCK_GRAPH_JSON/);
});
