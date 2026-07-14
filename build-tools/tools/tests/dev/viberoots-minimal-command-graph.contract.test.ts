#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import { test } from "node:test";
import { viberootsSourcePath } from "../lib/test-helpers/source-paths";

test("minimal viberoots dispatcher keeps heavyweight commands behind dynamic imports", async () => {
  const source = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/dev/viberoots.ts"),
    "utf8",
  );
  for (const module of [
    "../lib/consumer-bootstrap",
    "../lib/bootstrap-completion",
    "../lib/consumer-source-mode",
    "../lib/maintenance-gc",
    "../deployments/resource-graph-export",
  ]) {
    const escaped = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(source, new RegExp(`^import .*from [\"']${escaped}[\"'];?$`, "m"));
    assert.match(source, new RegExp(`import\\(\"${escaped}\"\\)`));
  }
  assert.match(source, /consumer-source-mode-detect/);
});

test("bootstrap completion and starter config avoid eager deployment graphs", async () => {
  const completion = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/lib/bootstrap-completion.ts"),
    "utf8",
  );
  const templates = await fsp.readFile(
    viberootsSourcePath("build-tools/tools/deployments/sprinkleref-templates.ts"),
    "utf8",
  );
  assert.doesNotMatch(completion, /^import .*consumer-bootstrap/m);
  assert.match(completion, /await import\("\.\/consumer-bootstrap"\)/);
  assert.doesNotMatch(templates, /aws-account-inputs|infisical-iac-bootstrap-config/);
  assert.match(templates, /project-config-paths/);
  assert.match(templates, /bootstrap-starter-defaults/);
});
