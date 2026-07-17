#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const root = "viberoots/build-tools/tools";

function read(rel: string): string {
  return fs.readFileSync(`${root}/${rel}`, "utf8");
}

test("b fails closed at canonical policy admission before artifact materialization", () => {
  const runner = read("dev/dev-build/run-dev-build.ts");
  const inventory = read("dev/dev-build/untracked.ts");
  assert.match(inventory, /inspectWorkspaceArtifactSource/);
  assert.doesNotMatch(inventory, /git ls-files|catch \{\}|return \{ impure: false \};\s*\}/);
  assert.match(inventory, /classification: "diagnostic-impure"/);
  assert.match(inventory, /classification: "local-development"/);
  const admission = runner.indexOf("await admitArtifactContext");
  assert.ok(admission > runner.indexOf("await runStartupCheck"));
  assert.ok(admission < runner.indexOf("await materializePureGraphIfEnabled"));
  assert.ok(admission < runner.indexOf("await runBuckCommand"));
});

test("runnable graph admission precedes snapshots and builds without a live-source fallback", () => {
  const graph = read("dev/run-runnable-graph.ts");
  const source = read("dev/run-runnable-source.ts");
  assert.match(source, /inspectWorkspaceArtifactSource/);
  assert.match(source, /purpose: opts\.purpose/);
  assert.ok(
    source.indexOf("await admitArtifactContext") < source.indexOf("await makeFilteredFlakeRef"),
  );
  assert.doesNotMatch(source, /catch\s*\{\s*return \{ flakeRef:/);
  assert.doesNotMatch(source, /git ls-files --others/);
  assert.match(graph, /chooseRunnableFlakeRef/);
  assert.match(source, /impureEvaluation: false/);
  assert.match(graph, /withoutEvaluationSelectors/);
  assert.doesNotMatch(graph, /["']--impure["']/);
});

test("every deployment runnable caller propagates a fixed protected purpose", () => {
  const deploymentRoot = `${root}/deployments`;
  const directCallers = fs
    .readdirSync(deploymentRoot)
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => read(`deployments/${entry}`).includes("buildSelectedOutPath"));
  assert.deepEqual(directCallers, ["deployment-component-artifact-dirs.ts"]);
  assert.match(read(`deployments/${directCallers[0]}`), /purpose: "deployment"/);

  const callers = fs
    .readdirSync(deploymentRoot)
    .filter((entry) => entry.endsWith(".ts"))
    .filter((entry) => read(`deployments/${entry}`).includes("buildDeploymentSelectedOutPath"));
  assert.deepEqual(callers.sort(), [
    "cloudflare-pages-artifact-input.ts",
    "deployment-cli-resolve.ts",
    "deployment-component-artifact-dirs.ts",
    "deployment-execution.ts",
    "nixos-shared-host-remote-cli.ts",
    "opentofu-foundation-front-door.ts",
  ]);
  for (const caller of callers) {
    const source = read(`deployments/${caller}`);
    assert.match(source, /buildDeploymentSelectedOutPath/);
  }
});

test("canonical CI artifact root does not rely on ambient job purpose", () => {
  const roots = [["ci/run-stage.ts", "ci"]] as const;
  for (const [file, purpose] of roots) {
    const source = read(file);
    assert.match(source, /inspectWorkspaceArtifactSource/);
    assert.match(source, /admitArtifactContext/);
    assert.match(source, new RegExp(`purpose: ["']${purpose}["']`));
  }
});
