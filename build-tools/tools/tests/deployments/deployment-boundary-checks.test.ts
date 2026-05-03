#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appTargetBoundaryErrors,
  mcpSourceResponseBoundaryErrors,
} from "../../deployments/deployment-boundary-checks.ts";

test("app target boundary rejects imports from another app target", () => {
  const errors = appTargetBoundaryErrors([
    {
      name: "//projects/apps/console:app",
      deps: ["//projects/apps/data-room-web:app", "//projects/libs/shared-ui:lib"],
    },
    { name: "//projects/apps/data-room-web:app", deps: [] },
  ]);
  assert.deepEqual(errors, [
    "//projects/apps/console:app: app target must not import app target //projects/apps/data-room-web:app",
  ]);
});

test("app target boundary allows app-local and library imports", () => {
  assert.deepEqual(
    appTargetBoundaryErrors([
      {
        name: "//projects/apps/console:app",
        deps: ["//projects/apps/console:routes", "//projects/libs/shared-ui:lib"],
      },
    ]),
    [],
  );
});

test("MCP source response boundary rejects forbidden forensic fields", () => {
  const errors = mcpSourceResponseBoundaryErrors({
    id: "source-1",
    metadata: { rawForensics: ["trace"], title: "redacted source" },
  });
  assert.deepEqual(errors, ["MCP source response exposes forbidden field metadata.rawForensics"]);
});
