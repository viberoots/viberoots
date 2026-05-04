#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import {
  prepareRemoteExecFixture,
  remoteExecEnv,
  REVIEWED_PLEOMINO_DEPLOYMENT_LABEL,
} from "./nixos-shared-host.deploy.remote-exec.helpers";

test("remote deploy rejects legacy host-apply mutation flags in service-only mode", async () => {
  await runInTemp("nixos-shared-host-remote-host-apply-rejected", async (tmp, $) => {
    const { env, artifactDir, admissionEvidencePath, profileRoot } = await prepareRemoteExecFixture(
      {
        tmp,
        $,
        artifactFiles: { "index.html": "<html>apply</html>\n", healthz: "ok\n" },
      },
    );
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(env),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --apply-host`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /service-only remote profiles do not support/);
  });
});

test("remote deploy rejects host-apply path overrides in service-only mode", async () => {
  await runInTemp("nixos-shared-host-remote-host-apply-overrides-rejected", async (tmp, $) => {
    const { env, artifactDir, admissionEvidencePath, profileRoot } = await prepareRemoteExecFixture(
      {
        tmp,
        $,
        artifactFiles: { "index.html": "<html>apply</html>\n", healthz: "ok\n" },
      },
    );
    const result = await $({
      cwd: tmp,
      env: remoteExecEnv(env),
    })`zx-wrapper build-tools/tools/deployments/deploy.ts --deployment ${REVIEWED_PLEOMINO_DEPLOYMENT_LABEL} --admission-evidence-json ${admissionEvidencePath} --profile mini --profile-root ${profileRoot} --artifact-dir ${artifactDir} --remote-config-root /srv/nixos`.nothrow();
    assert.notEqual(result.exitCode, 0);
    assert.match(String(result.stderr), /service-only remote profiles do not support/);
  });
});
