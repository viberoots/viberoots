#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

async function readRepoFile(relativePath: string): Promise<string> {
  return await fsp.readFile(viberootsSourcePath(relativePath), "utf8");
}

test("canonical runtime-path contract: runtime and planner surfaces stay manifest-driven", async () => {
  const runnables = await readRepoFile("build-tools/tools/lib/runnables.ts");
  const runnableWasmArtifacts = await readRepoFile(
    "build-tools/tools/lib/runnable-wasm-artifacts.ts",
  );
  const plannerManifest = await readRepoFile("build-tools/tools/nix/planner/manifest.nix");
  const scaffoldHelper = await readRepoFile("build-tools/tools/tests/lib/ssr-scaffold-build.ts");
  const buildSystemDesign = await readRepoFile("build-tools/docs/build-system-design.md");
  const scaffoldReadme = await readRepoFile(
    "build-tools/tools/scaffolding/templates/ts/README.md.jinja",
  );

  assert.doesNotMatch(runnables, /server\/wasm-contract\/top\.wasm/);
  assert.match(runnables, /resolveServerWasmContractArtifact/);
  assert.match(runnableWasmArtifacts, /wasm-modules\.manifest\.json/);
  assert.match(runnableWasmArtifacts, /runtimeDestinations\.server/);

  assert.doesNotMatch(plannerManifest, /server\/wasm-contract\/top\.wasm/);
  assert.match(plannerManifest, /wasm-modules\.manifest\.json/);
  assert.match(plannerManifest, /runtimeDestinations\.server/);

  assert.doesNotMatch(scaffoldHelper, /server\/wasm-contract\/top\.wasm/);
  assert.match(scaffoldHelper, /readCanonicalServerWasmArtifact/);

  assert.match(buildSystemDesign, /dist\/server\/wasm\/<default-module>\.wasm/);
  assert.match(scaffoldReadme, /dist\/server\/wasm\/<default-module>\.wasm/);
});
