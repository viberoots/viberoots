#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appTargetBoundaryErrors,
  mcpSourceResponseBoundaryErrors,
  providerInfisicalImportBoundaryErrors,
} from "../../deployments/deployment-boundary-checks";

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

test("provider boundary rejects direct Infisical adapter imports", () => {
  const errors = providerInfisicalImportBoundaryErrors([
    {
      name: "//build-tools/tools/deployments:cloudflare-pages-static-deploy",
      deps: ["//build-tools/tools/deployments:deployment-secret-infisical"],
    },
    {
      name: "//build-tools/tools/deployments:deployment-secret-backend-registry",
      deps: ["//build-tools/tools/deployments:deployment-secret-infisical"],
    },
    {
      name: "//build-tools/tools/deployments:kubernetes-publisher",
      deps: ["//build-tools/tools/deployments:deployment-secret-runtime-helpers"],
    },
  ]);
  assert.deepEqual(errors, [
    "//build-tools/tools/deployments:cloudflare-pages-static-deploy: provider code must not import //build-tools/tools/deployments:deployment-secret-infisical directly",
  ]);
});
