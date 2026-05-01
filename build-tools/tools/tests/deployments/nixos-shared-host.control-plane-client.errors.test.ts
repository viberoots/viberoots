#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTROL_PLANE_SUBMISSION_TIMEOUT_MS,
  createNixosSharedHostArtifactChallengeViaService,
  submitNixosSharedHostControlPlaneViaService,
} from "../../deployments/nixos-shared-host-control-plane-client.ts";

test("control-plane client default submit wait covers long smoke budgets", () => {
  assert.equal(CONTROL_PLANE_SUBMISSION_TIMEOUT_MS, 10 * 60 * 1000);
});

test("control-plane client reports a missing artifact challenge route clearly", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        createNixosSharedHostArtifactChallengeViaService({
          controlPlaneUrl: "https://deploy.apps.kilty.io",
          token: "token",
          request: {} as any,
        }),
      /does not expose \/api\/v1\/submission-challenges\/artifact/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("control-plane client preserves non-route errors from submissions", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "unsupported schema version: undefined" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        submitNixosSharedHostControlPlaneViaService({
          controlPlaneUrl: "https://deploy.apps.kilty.io",
          token: "token",
          request: {} as any,
        }),
      /unsupported schema version: undefined/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("control-plane client warns that hosted submissions can take a while", async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const messages: string[] = [];
  console.error = (...args) => messages.push(args.join(" "));
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const isSubmission = url.pathname.endsWith("/submissions");
    return new Response(
      JSON.stringify({
        schemaVersion: isSubmission
          ? "deployment-control-plane-submit-response@1"
          : "deployment-control-plane-status@1",
        submissionId: "cp-wait",
        submittedAt: "2026-05-01T00:00:00.000Z",
        deploymentId: "demoapp-dev",
        deploymentLabel: "//projects/deployments/demoapp-dev:deploy",
        operationKind: "deploy",
        providerTargetIdentity: "cloudflare-pages:demo/demoapp",
        lockScope: "cloudflare-pages:demo/demoapp",
        lifecycleState: isSubmission ? "running" : "finished",
        terminationReason: null,
        dedupe: { mode: "created", requestFingerprint: "sha256:test" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await submitNixosSharedHostControlPlaneViaService({
      controlPlaneUrl: "https://deploy.apps.kilty.io",
      token: "token",
      request: {} as any,
      pollMs: 1,
      timeoutMs: 10 * 60 * 1000,
    });
    const message = messages.join("\n");
    assert.match(message, /waiting up to 10 minutes/);
    assert.match(message, /This can take a while/);
    assert.match(message, /deploy --status --submission-id cp-wait/);
  } finally {
    console.error = previousError;
    globalThis.fetch = previousFetch;
  }
});

test("control-plane client timeout message points operators at status lookup", async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  console.error = () => {};
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    const lifecycleState = url.pathname.endsWith("/submissions") ? "running" : "running";
    return new Response(
      JSON.stringify({
        schemaVersion: url.pathname.endsWith("/submissions")
          ? "deployment-control-plane-submit-response@1"
          : "deployment-control-plane-status@1",
        submissionId: "cp-timeout",
        submittedAt: "2026-05-01T00:00:00.000Z",
        deploymentId: "demoapp-dev",
        deploymentLabel: "//projects/deployments/demoapp-dev:deploy",
        operationKind: "deploy",
        providerTargetIdentity: "cloudflare-pages:demo/demoapp",
        lockScope: "cloudflare-pages:demo/demoapp",
        lifecycleState,
        terminationReason: null,
        dedupe: { mode: "created", requestFingerprint: "sha256:test" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        submitNixosSharedHostControlPlaneViaService({
          controlPlaneUrl: "https://deploy.apps.kilty.io",
          token: "token",
          request: {} as any,
          pollMs: 1,
          timeoutMs: 5,
        }),
      /deploy --status --submission-id cp-timeout/,
    );
  } finally {
    console.error = previousError;
    globalThis.fetch = previousFetch;
  }
});
