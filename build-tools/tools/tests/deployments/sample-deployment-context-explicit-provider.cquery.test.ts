#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { writeSampleDeploymentContextFixture } from "./sample-deployment-context.fixture";
import { inheritedBuckIsolation, runInTemp } from "../lib/test-helpers";

test("sample wrapper rejects legacy explicit Cloudflare provider values", async () => {
  await runInTemp("sample-context-explicit-provider-drift", async (tmp, $) => {
    await writeSampleDeploymentContextFixture(tmp, { explicitProviderValues: true });
    const result = await $({
      cwd: tmp,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
        SSL_CERT_FILE: process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE,
      },
    })`buck2 --isolation-dir ${inheritedBuckIsolation("sample-context-explicit-provider")} cquery --target-platforms prelude//platforms:default //projects/deployments/sample-webapp/staging:deploy`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(
      String(result.stdout) + String(result.stderr),
      /sample_webapp_cloudflare_deployment must not set account; provider_target\.account comes from deployment context sample-webapp-staging/,
    );
  });
});
