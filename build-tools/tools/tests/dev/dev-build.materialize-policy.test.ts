#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { prebuildDiagnosticsRequireMaterialize } from "../../dev/dev-build/materialize-policy.ts";

test("materialize policy requires full path when diagnostics are missing", () => {
  assert.equal(prebuildDiagnosticsRequireMaterialize(null, 5000), true);
});

test("materialize policy requires full path when outputs/providers are missing", () => {
  assert.equal(
    prebuildDiagnosticsRequireMaterialize({ missingOutputs: ["graph.json"] }, 5000),
    true,
  );
  assert.equal(
    prebuildDiagnosticsRequireMaterialize(
      { missingNodeProviders: [{ importer: "projects/apps/myapp" }] },
      5000,
    ),
    true,
  );
  assert.equal(
    prebuildDiagnosticsRequireMaterialize(
      { missingPythonProviders: [{ importer: "projects/libs/mylib" }] },
      5000,
    ),
    true,
  );
  assert.equal(
    prebuildDiagnosticsRequireMaterialize({ coverageMissing: [{ node: "x" }] }, 5000),
    true,
  );
});

test("materialize policy requires full path when freshness skew exceeded", () => {
  assert.equal(
    prebuildDiagnosticsRequireMaterialize({ summary: { ageDeltaMs: 6000 } }, 5000),
    true,
  );
});

test("materialize policy skips materialize only when diagnostics are fresh", () => {
  const diagnostics = {
    missingOutputs: [],
    missingNodeProviders: [],
    missingPythonProviders: [],
    coverageMissing: [],
    summary: { ageDeltaMs: 2000 },
  };
  assert.equal(prebuildDiagnosticsRequireMaterialize(diagnostics, 5000), false);
});
