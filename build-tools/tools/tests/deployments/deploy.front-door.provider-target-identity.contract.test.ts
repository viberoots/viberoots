#!/usr/bin/env zx-wrapper
import { viberootsToolScript } from "./deployment-command";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { writeTempCloudflareValidationWorkspace } from "./deploy.front-door.fixture";
import { runInTemp } from "../lib/test-helpers";

test("deploy --print-target-identity prints the canonical normal-flow target identity", async () => {
  await runInTemp("deploy-print-target-identity", async (tmp, $) => {
    const recordsRoot = path.join(tmp, "records");
    await writeTempCloudflareValidationWorkspace(tmp);
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
    })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-staging:deploy --print-target-identity`;
    assert.equal(
      String(result.stdout).trim(),
      "cloudflare-pages:web-platform-staging/demo-staging-pages",
    );
    assert.equal(
      await fsp
        .access(recordsRoot)
        .then(() => "present")
        .catch(() => "missing"),
      "missing",
    );
  });
});

test("deploy --print-target-identity is mutually exclusive with --validate-only", async () => {
  await runInTemp("deploy-print-target-identity-exclusive", async (tmp, $) => {
    await writeTempCloudflareValidationWorkspace(tmp);
    await assert.rejects(
      async () =>
        await $({
          cwd: tmp,
          stdio: "pipe",
        })`zx-wrapper ${viberootsToolScript("build-tools/tools/deployments/deploy.ts")} --deployment //sandbox/deployments/demo-staging:deploy --print-target-identity --validate-only`,
      /--print-target-identity cannot be combined/,
    );
  });
});
